const {
    USERNAME,
    PASSWORD,
    COURSE_CONCURRENCY,
    MAX_COURSES,
    COURSE_CENTER_URL,
    ENABLE_LEARNING,
    ENABLE_DISCUSSION,
    ENABLE_HOMEWORK,
    DISCUSSION_INTERVAL_MS,
    DISCUSSION_MAX_POSTS,
    DISCUSSION_SCAN_PAGES,
    DISCUSSION_MAX_ROUNDS,
    HOMEWORK_MAX_TASKS
} = require('./config');
const { launchBrowser, locateInAnyFrame, humanClick, handleCaptcha } = require('./browser');
const { learnCourse } = require('./course');
const { runCourseTaskWorker } = require('./task_worker');
const { createLogger } = require('./logger');

const DEFAULT_OPTIONS = {
    enableLearning: ENABLE_LEARNING,
    enableDiscussion: ENABLE_DISCUSSION,
    enableHomework: ENABLE_HOMEWORK,
    enableTaskWorker: ENABLE_DISCUSSION || ENABLE_HOMEWORK,
    discussionIntervalMs: DISCUSSION_INTERVAL_MS,
    discussionMaxPosts: DISCUSSION_MAX_POSTS,
    discussionScanPages: DISCUSSION_SCAN_PAGES,
    discussionMaxRounds: DISCUSSION_MAX_ROUNDS,
    homeworkMaxTasks: HOMEWORK_MAX_TASKS
};

async function collectCourseIds(page) {
    const buttons = page.locator('a.course-right-bottom-btn, a:has-text("继续学习"), a:has-text("开始学习"), a:has-text("查看课程")');
    try {
        await buttons.first().waitFor({ state: 'visible', timeout: 10000 });
    } catch {}

    const count = await buttons.count();
    console.log(`找到 ${count} 个课程按钮`);

    const courseMap = new Map();
    for (let index = 0; index < count; index++) {
        const btn = buttons.nth(index);
        const href = await btn.getAttribute('href');
        if (!href) continue;
        const matches = href.match(/\d{6,}/g) || [];
        const courseId = matches[matches.length - 1];
        if (!courseId) continue;
        if (courseMap.has(courseId)) continue;

        // 提取课程中文名称：从按钮所在的课程卡片中查找标题
        let courseName = '';
        try {
            courseName = await btn.evaluate(el => {
                // 向上查找课程卡片容器
                const container = el.closest('.course-item, .course-card, .course_box, [class*="course"]') || el.parentElement?.parentElement?.parentElement;
                if (!container) return '';
                // 尝试多种标题选择器
                const titleEl = container.querySelector('.course-name, .course-title, .course_info h3, h3, h4, .name, .title')
                    || container.querySelector('[class*="title"], [class*="name"]');
                return titleEl ? (titleEl.innerText || '').trim() : '';
            }) || '';
        } catch {}

        // 如果找不到中文名称，从页面标题或其他元素中提取
        if (!courseName) {
            courseName = '';
        }

        courseMap.set(courseId, courseName);
        console.log(`  课程 ${index + 1}: ${courseId} ${courseName ? `(${courseName})` : ''} (${href})`);
    }

    return [...courseMap.entries()].map(([id, name]) => ({ id, name }));
}

async function login(page) {
    console.log('访问 UOOC...');

    const maxLoginRetries = 3;
    let usernameInput = null;

    for (let attempt = 1; attempt <= maxLoginRetries; attempt++) {
        if (attempt > 1) {
            console.log(`刷新后重试登录页 (${attempt}/${maxLoginRetries})...`);
            try {
                await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
            } catch {}
            await page.waitForTimeout(2000);
        } else {
            await page.goto('https://www.uooc.net.cn/', { waitUntil: 'networkidle' });
            await page.waitForTimeout(2000);
        }

        try {
            await page.waitForSelector('#loginBtn', { state: 'visible', timeout: 10000 });
            await page.click('#loginBtn');
        } catch {
            console.log('未找到登录按钮，继续重试...');
            continue;
        }
        await page.waitForTimeout(2000);

        usernameInput = await locateInAnyFrame(page, '#account1');
        if (usernameInput) break;
        console.log(`未找到用户名输入框，继续重试... (${attempt}/${maxLoginRetries})`);
    }

    if (!usernameInput) {
        throw new Error('多次重试后仍未找到用户名输入框');
    }

    const locate = selector => locateInAnyFrame(page, selector);
    await usernameInput.fill(USERNAME);
    const passwordInput = await locate('#password');
    await passwordInput.fill(PASSWORD);

    await handleCaptcha(page, locate, async () => {
        const button = await locate('button[type="submit"].btn.btn-warning:visible');
        if (!button) return false;
        return !(await button.evaluate(element => element.disabled));
    });

    console.log('提交登录...');
    const submitBtn = await locate('button[type="submit"].btn.btn-warning:visible');
    if (submitBtn) await humanClick(page, submitBtn);
    await page.waitForTimeout(5000);
}

async function run(runtimeOptions = {}) {
    const options = { ...DEFAULT_OPTIONS, ...runtimeOptions };
    options.enableTaskWorker = options.enableDiscussion || options.enableHomework;

    const onStats = options.onStats || (() => {});

    const { browser, context, page } = await launchBrowser();

    // 跟踪浏览器断开状态
    let browserDisconnected = false;
    browser.on('disconnected', () => {
        browserDisconnected = true;
    });

    try {
        try {
            await login(page);
        } catch (loginErr) {
            if (browserDisconnected) {
                console.log('浏览器已关闭，任务停止');
                return { browserDisconnected: true };
            }
            throw loginErr;
        }

        try {
            await page.goto(COURSE_CENTER_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (navErr) {
            if (browserDisconnected) {
                console.log('浏览器已关闭，任务停止');
                return { browserDisconnected: true };
            }
            throw navErr;
        }
        await page.waitForTimeout(5000);

        let courses = await collectCourseIds(page);
        if (MAX_COURSES > 0) {
            courses = courses.slice(0, MAX_COURSES);
        }

        if (courses.length === 0) {
            console.log('没有课程可处理');
            return;
        }

        // 通知总课程数
        onStats({ totalCourses: courses.length });

        console.log('\n开始调度课程...');
        console.log(`  学习: ${options.enableLearning ? '开' : '关'} / 评论: ${options.enableDiscussion ? '开' : '关'} / 作业: ${options.enableHomework ? '开' : '关'}\n`);

        let taskWorkerPromise = Promise.resolve();
        if (options.enableTaskWorker) {
            console.log('启动评论/作业独立窗口...');
            taskWorkerPromise = runCourseTaskWorker(context, courses.map(c => c.id), {
                ...options,
                createLogger
            }).catch(err => {
                console.error('评论/作业窗口失败:', err.message);
            });
        }

        if (options.enableLearning) {
            let completedCount = 0;
            let failedCount = 0;

            async function processCourse(course, index) {
                if (browserDisconnected) return;

                const courseId = course.id;
                const courseName = course.name || courseId;
                const tag = `[课程${index + 1}/${courses.length}:${courseName}]`;
                const log = createLogger(tag, index);

                onStats({ currentCourse: courseName, runningCourses: 1 });

                const learnPage = await context.newPage().catch(() => null);
                if (!learnPage) {
                    failedCount++;
                    onStats({ failedCourses: failedCount });
                    return;
                }

                try {
                    const oldLearnUrl = `http://www.uooc.net.cn/home/learn/index#/${courseId}/go`;
                    log(`打开老界面学习页: ${oldLearnUrl}`);
                    await learnPage.goto(oldLearnUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    await learnPage.waitForTimeout(5000);

                    if (browserDisconnected) return;

                    await learnCourse(learnPage, courseId, log, options);
                    log('课程完成');
                    completedCount++;
                    onStats({ completedCourses: completedCount });
                } catch (err) {
                    if (browserDisconnected) return;
                    log(`学习流程失败: ${err.message}`);
                    failedCount++;
                    onStats({ failedCourses: failedCount });
                } finally {
                    await learnPage.close().catch(() => {});
                }
            }

            const pending = new Set();
            const queue = courses.map((course, index) => () => processCourse(course, index));

            for (const task of queue) {
                if (browserDisconnected) break;
                if (pending.size >= COURSE_CONCURRENCY) {
                    await Promise.race(pending);
                }
                const promise = task().then(
                    () => pending.delete(promise),
                    () => pending.delete(promise)
                );
                pending.add(promise);
            }

            await Promise.all(pending);
        } else {
            console.log('已关闭自动学习');
        }

        await taskWorkerPromise;

        if (browserDisconnected) {
            console.log('\n浏览器已关闭，任务已停止');
            return { browserDisconnected: true };
        } else {
            console.log('\n所有课程处理完毕');
            return { browserDisconnected: false };
        }
    } finally {
        // 安全关闭浏览器
        if (!browserDisconnected) {
            try {
                await browser.close();
            } catch {}
        }
    }
}

module.exports = { run, collectCourseIds };
