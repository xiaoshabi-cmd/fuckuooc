// ============================================================
// FuckUOOC GUI - 渲染进程逻辑
// ============================================================

(function () {
  'use strict';

  const { electronAPI } = window;

  // ============================================================
  // 状态管理
  // ============================================================
  const state = {
    currentPage: 'dashboard',
    taskRunning: false,
    taskStats: null,
    config: {},
    autoLaunch: false,
    logs: [],
    logFilter: 'all',
    logCourseFilter: 'all',
    autoScroll: true,
    activities: [],
    courses: new Set() // 已出现的课程列表
  };

  // ============================================================
  // DOM 元素引用
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ============================================================
  // 页面导航
  // ============================================================
  function initNavigation() {
    $$('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const page = btn.dataset.page;
        if (page === state.currentPage) return;

        // 更新导航状态
        $$('.nav-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 切换页面
        $$('.page').forEach(p => p.classList.remove('active'));
        $(`#page-${page}`).classList.add('active');

        state.currentPage = page;
      });
    });
  }

  // ============================================================
  // 窗口控制
  // ============================================================
  function initWindowControls() {
    $('#btn-minimize').addEventListener('click', () => electronAPI.window.minimize());
    $('#btn-maximize').addEventListener('click', () => electronAPI.window.maximize());
    $('#btn-close').addEventListener('click', () => electronAPI.window.close());
  }

  // ============================================================
  // 仪表盘
  // ============================================================
  function updateDashboard() {
    const stats = state.taskStats || {};
    $('#stat-total').textContent = stats.totalCourses || 0;
    $('#stat-completed').textContent = stats.completedCourses || 0;
    $('#stat-running').textContent = stats.runningCourses || 0;
    $('#stat-failed').textContent = stats.failedCourses || 0;

    const indicator = $('#task-status-indicator .status-dot');
    const statusText = $('#task-status-text');
    const taskInfo = $('#task-info');
    const startBtn = $('#btn-start-task');
    const stopBtn = $('#btn-stop-task');

    if (state.taskRunning) {
      indicator.className = 'status-dot running';
      statusText.textContent = '运行中';
      taskInfo.style.display = 'block';
      startBtn.style.display = 'none';
      stopBtn.style.display = 'inline-flex';

      // 更新进度
      const total = stats.totalCourses || 0;
      const completed = stats.completedCourses || 0;
      const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
      $('#task-progress-fill').style.width = `${progress}%`;
      $('#task-progress-text').textContent = `${progress}%`;

      if (stats.currentCourse) {
        $('#task-current-course').textContent = `当前课程: ${stats.currentCourse}`;
      }

      // 更新全局状态栏
      $('#global-status-dot').className = 'status-indicator-dot running';
      $('#global-status-text').textContent = '任务运行中';
    } else {
      indicator.className = 'status-dot';
      statusText.textContent = '未运行';
      taskInfo.style.display = 'none';
      startBtn.style.display = 'inline-flex';
      stopBtn.style.display = 'none';

      $('#global-status-dot').className = 'status-indicator-dot';
      $('#global-status-text').textContent = '就绪';
    }
  }

  function addActivity(message) {
    const now = new Date();
    const time = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

    state.activities.unshift({ time, message });
    if (state.activities.length > 50) state.activities.pop();

    renderActivities();
  }

  function renderActivities() {
    const list = $('#activity-list');
    if (state.activities.length === 0) {
      list.innerHTML = '<div class="activity-empty">暂无活动记录</div>';
      return;
    }

    list.innerHTML = state.activities.map(a => `
      <div class="activity-item">
        <span class="activity-time">${a.time}</span>
        <span class="activity-content">${escapeHtml(a.message)}</span>
      </div>
    `).join('');
  }

  function initDashboard() {
    $('#btn-start-task').addEventListener('click', async () => {
      const config = collectConfigValues();
      addActivity('启动任务...');
      await electronAPI.task.start(config);
    });

    $('#btn-stop-task').addEventListener('click', async () => {
      addActivity('停止任务...');
      await electronAPI.task.stop();
    });

    // 监听任务状态
    electronAPI.task.onStatus((status) => {
      state.taskRunning = status.running;
      state.taskStats = status.stats;
      updateDashboard();

      if (status.completed) {
        addActivity('所有课程处理完毕');
      } else if (status.error) {
        addActivity(`任务异常: ${status.error}`);
      } else if (status.stopped) {
        if (status.reason === 'browser_closed') {
          addActivity('浏览器已关闭，任务已停止（应用继续运行）');
        } else {
          addActivity('任务已停止');
        }
      }
    });
  }

  // ============================================================
  // 配置管理
  // ============================================================
  function collectConfigValues() {
    return {
      USERNAME: $('#cfg-username').value.trim(),
      PASSWORD: $('#cfg-password').value.trim(),
      API_KEY: $('#cfg-apikey').value.trim(),
      MODEL: $('#cfg-model').value.trim(),
      RETRY_MODEL: $('#cfg-retry-model').value.trim(),
      BASE_URL: $('#cfg-baseurl').value.trim(),
      COURSE_CONCURRENCY: $('#cfg-concurrency').value,
      MAX_COURSES: $('#cfg-max-courses').value,
      SLOW_MO: $('#cfg-slow-mo').value,
      HEADLESS: $('#cfg-headless').checked ? 'true' : 'false',
      ENABLE_LEARNING: $('#cfg-enable-learning').checked ? 'true' : 'false',
      ENABLE_DISCUSSION: $('#cfg-enable-discussion').checked ? 'true' : 'false',
      ENABLE_HOMEWORK: $('#cfg-enable-homework').checked ? 'true' : 'false'
    };
  }

  function populateConfigForm(cfg) {
    state.config = cfg;
    $('#cfg-username').value = cfg.USERNAME || '';
    $('#cfg-password').value = cfg.PASSWORD || '';
    $('#cfg-apikey').value = cfg.API_KEY || '';
    $('#cfg-model').value = cfg.MODEL || '';
    $('#cfg-retry-model').value = cfg.RETRY_MODEL || '';
    $('#cfg-baseurl').value = cfg.BASE_URL || '';
    $('#cfg-concurrency').value = cfg.COURSE_CONCURRENCY || '3';
    $('#cfg-max-courses').value = cfg.MAX_COURSES || '0';
    $('#cfg-slow-mo').value = cfg.SLOW_MO || '100';
    $('#cfg-headless').checked = cfg.HEADLESS === 'true';
    $('#cfg-enable-learning').checked = cfg.ENABLE_LEARNING !== 'false';
    $('#cfg-enable-discussion').checked = cfg.ENABLE_DISCUSSION === 'true';
    $('#cfg-enable-homework').checked = cfg.ENABLE_HOMEWORK === 'true';
  }

  function initConfig() {
    // 加载配置
    electronAPI.config.read().then(cfg => {
      populateConfigForm(cfg);
    });

    // 保存配置
    $('#btn-save-config').addEventListener('click', async () => {
      const cfg = collectConfigValues();
      await electronAPI.config.write(cfg);
      state.config = cfg;

      // 显示保存成功提示
      const toast = $('#config-save-toast');
      toast.style.display = 'flex';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 2500);

      addActivity('配置已保存');
    });

    // 重置配置
    $('#btn-reset-config').addEventListener('click', () => {
      electronAPI.config.read().then(cfg => {
        populateConfigForm(cfg);
        addActivity('配置已重置');
      });
    });

    // 密码显示/隐藏
    $$('.btn-toggle-password').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.parentElement.querySelector('input');
        input.type = input.type === 'password' ? 'text' : 'password';
      });
    });
  }

  // ============================================================
  // 日志管理
  // ============================================================
  function addLogEntry(entry) {
    // 提取课程名称
    const courseName = extractCourseName(entry.message);
    entry.courseName = courseName;
    state.logs.push(entry);
    if (state.logs.length > 1000) state.logs.shift();

    // 更新课程列表
    if (courseName && !state.courses.has(courseName)) {
      state.courses.add(courseName);
      updateCourseFilter();
    }

    if (shouldShowLog(entry)) {
      renderLogEntry(entry);
    }
  }

  function shouldShowLog(entry) {
    if (state.logFilter !== 'all' && entry.level !== state.logFilter) return false;
    if (state.logCourseFilter !== 'all' && entry.courseName !== state.logCourseFilter) return false;
    return true;
  }

  function updateCourseFilter() {
    const select = $('#log-course-filter');
    const current = select.value;
    select.innerHTML = '<option value="all">全部课程</option>';
    for (const course of state.courses) {
      const opt = document.createElement('option');
      opt.value = course;
      opt.textContent = course;
      select.appendChild(opt);
    }
    select.value = state.courses.has(current) ? current : 'all';
  }

  function renderLogEntry(entry) {
    const output = $('#logs-output');
    const empty = output.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'log-entry';

    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const courseTag = entry.courseName
      ? `<span class="log-course-tag">${escapeHtml(entry.courseName)}</span>`
      : '';

    div.innerHTML = `
      <span class="log-time">${time}</span>
      <span class="log-level log-level-${entry.level}">${entry.level.toUpperCase()}</span>
      ${courseTag}
      <span class="log-message">${escapeHtml(entry.message)}</span>
    `;

    output.appendChild(div);

    if (state.autoScroll) {
      output.scrollTop = output.scrollHeight;
    }
  }

  function renderAllLogs() {
    const output = $('#logs-output');
    output.innerHTML = '';

    const filtered = state.logs.filter(shouldShowLog);
    if (filtered.length === 0) {
      output.innerHTML = '<div class="log-empty">等待日志输出...</div>';
      return;
    }

    filtered.forEach(entry => renderLogEntry(entry));
  }

  function initLogs() {
    // 订阅日志
    electronAPI.log.subscribe();
    electronAPI.log.onEntry((entry) => {
      addLogEntry(entry);
    });

    // 日志级别过滤
    $$('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.logFilter = btn.dataset.level;
        renderAllLogs();
      });
    });

    // 课程筛选
    $('#log-course-filter').addEventListener('change', (e) => {
      state.logCourseFilter = e.target.value;
      renderAllLogs();
    });

    // 导出日志
    $('#btn-export-logs').addEventListener('click', async () => {
      const logs = await electronAPI.log.export();
      if (!logs || logs.length === 0) {
        addActivity('没有可导出的日志');
        return;
      }
      const content = logs.map(l => l.raw).join('\n');
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const now = new Date();
      a.href = url;
      a.download = `fuckuooc-log-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      addActivity('日志已导出');
    });

    // 清空日志
    $('#btn-clear-logs').addEventListener('click', () => {
      state.logs = [];
      state.courses.clear();
      updateCourseFilter();
      const output = $('#logs-output');
      output.innerHTML = '<div class="log-empty">等待日志输出...</div>';
    });

    // 自动滚动
    $('#btn-toggle-autoscroll').addEventListener('click', (e) => {
      state.autoScroll = !state.autoScroll;
      e.currentTarget.classList.toggle('active', state.autoScroll);
    });
  }

  // ============================================================
  // 设置管理
  // ============================================================
  async function initSettings() {
    // 加载自启动状态
    state.autoLaunch = await electronAPI.autostart.status();
    $('#setting-autostart').checked = state.autoLaunch;

    // 自启动开关
    $('#setting-autostart').addEventListener('change', async (e) => {
      const enabled = e.target.checked;
      state.autoLaunch = await electronAPI.autostart.toggle(enabled);
      e.target.checked = state.autoLaunch;
      addActivity(`开机自启动已${state.autoLaunch ? '开启' : '关闭'}`);
    });

    // 加载 GUI 设置
    const cfg = await electronAPI.config.read();
    $('#setting-start-minimized').checked = cfg.START_MINIMIZED === 'true';
    $('#setting-close-browser').checked = cfg.CLOSE_BROWSER_ON_FINISH === 'true';
    $('#setting-close-app').checked = cfg.CLOSE_APP_ON_FINISH === 'true';
    $('#setting-auto-save-log').checked = cfg.AUTO_SAVE_LOG === 'true';

    // 设置变更时自动保存
    const saveSetting = async (key, value) => {
      const currentCfg = await electronAPI.config.read();
      currentCfg[key] = value ? 'true' : 'false';
      await electronAPI.config.write(currentCfg);
      addActivity(`设置已更新: ${key} = ${value}`);
    };

    $('#setting-start-minimized').addEventListener('change', (e) => {
      saveSetting('START_MINIMIZED', e.target.checked);
    });
    $('#setting-close-browser').addEventListener('change', (e) => {
      saveSetting('CLOSE_BROWSER_ON_FINISH', e.target.checked);
    });
    $('#setting-close-app').addEventListener('change', (e) => {
      saveSetting('CLOSE_APP_ON_FINISH', e.target.checked);
    });
    $('#setting-auto-save-log').addEventListener('change', (e) => {
      saveSetting('AUTO_SAVE_LOG', e.target.checked);
    });

    // 系统信息
    const info = await electronAPI.system.info();
    $('#info-app-version').textContent = info.appVersion || '1.0.0';
    $('#info-electron-version').textContent = info.electronVersion || '-';
    $('#info-node-version').textContent = info.nodeVersion || '-';
    $('#info-platform').textContent = `${info.platform} ${info.arch}`;
  }

  // ============================================================
  // 工具函数
  // ============================================================
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * 从日志消息中提取课程名称
   * 匹配模式: [课程X/Y:课程名称] 或 [课程X/Y:COURSE_ID]
   * 支持中文课程名如 "大学生心理健康" 和纯数字ID如 "123456"
   */
  function extractCourseName(message) {
    const match = message.match(/\[课程[\d/]+[:\s]*(.+?)\]/);
    if (!match) return '';
    const name = match[1].trim();
    // 如果提取到的全是数字，保留为课程ID（向后兼容）
    return name;
  }

  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    $('#status-time').textContent = timeStr;
  }

  // ============================================================
  // 初始化
  // ============================================================
  async function init() {
    initNavigation();
    initWindowControls();
    initDashboard();
    initConfig();
    initLogs();
    await initSettings();

    // 时钟更新
    updateClock();
    setInterval(updateClock, 1000);

    // 检查任务状态
    const taskStatus = await electronAPI.task.status();
    if (taskStatus.running) {
      state.taskRunning = true;
      state.taskStats = taskStatus.stats;
      updateDashboard();
    }

    addActivity('应用已启动');
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
