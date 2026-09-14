/**
 * 命途扉页 - SillyTavern 聊天楼层导航器
 * 功能：楼层跳转、区间定位、关键词搜索、书签收藏、区间导出
 */

(function () {
    const extensionName = 'SillyTavern-ChatNavigator';
    const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

    // 设置存储 key
    const SETTINGS_KEY = 'chat_navigator';

    // 默认设置
    const defaultSettings = {
        bookmarks: {}, // { chatId: [{ start, end, label }] }
        buttonPosition: null,
    };

    // 状态
    let settings = {};
    let searchResults = [];
    let searchPage = 0;
    const RESULTS_PER_PAGE = 50;
    let searchDebounceTimer = null;
    let currentExportFormat = 'md';
    let currentFilter = 'all'; // all, user, char, hidden
    let isDraggingToggle = false;
    let didDragToggle = false;
    let dragStart = { x: 0, y: 0, left: 0, top: 0 };

    // ============ 初始化 ============

    function init() {
        loadSettings();
        injectUI();
        bindEvents();
        closePanel();
        console.log('[命途扉页] 插件已加载');
    }

    function loadSettings() {
        const context = SillyTavern.getContext();
        if (!context.extensionSettings[SETTINGS_KEY]) {
            context.extensionSettings[SETTINGS_KEY] = structuredClone(defaultSettings);
        }
        settings = context.extensionSettings[SETTINGS_KEY];
        settings.bookmarks ??= {};
        settings.buttonPosition ??= null;
    }

    function saveSettings() {
        const context = SillyTavern.getContext();
        context.extensionSettings[SETTINGS_KEY] = settings;
        context.saveSettingsDebounced();
    }

    // ============ UI 注入 ============

    function injectUI() {
        const panelHTML = `
        <div id="chat-navigator-toggle" title="命途扉页">📖</div>
        <div id="chat-navigator-panel" class="collapsed">
            <div class="cn-header">
                <h3>📖 命途扉页</h3>
                <span class="cn-close">✕</span>
            </div>
            <div class="cn-tabs">
                <div class="cn-tab active" data-tab="navigate">导航</div>
                <div class="cn-tab" data-tab="search">搜索</div>
                <div class="cn-tab" data-tab="bookmark">书签</div>
                <div class="cn-tab" data-tab="export">导出</div>
            </div>
            <div class="cn-body">
                <!-- 导航面板 -->
                <div class="cn-section active" data-section="navigate">
                    <div class="cn-input-group">
                        <input type="text" id="cn-goto-input" placeholder="输入楼层号，如 200">
                        <button class="cn-btn" id="cn-goto-btn">跳转</button>
                    </div>
                    <div class="cn-input-group">
                        <input type="text" id="cn-range-input" placeholder="输入区间，如 30-100">
                        <button class="cn-btn" id="cn-range-btn">定位</button>
                    </div>
                    <div class="cn-quick-btns">
                        <button class="cn-btn" id="cn-top-btn">⬆ 顶部</button>
                        <button class="cn-btn" id="cn-bottom-btn">⬇ 底部</button>
                    </div>
                </div>

                <!-- 搜索面板 -->
                <div class="cn-section" data-section="search">
                    <div class="cn-input-group">
                        <input type="text" id="cn-search-input" placeholder="关键词 / 日期(2026-01-01)">
                    </div>
                    <div class="cn-filter-row">
                        <span class="cn-filter-chip active" data-filter="all">全部</span>
                        <span class="cn-filter-chip" data-filter="user">用户</span>
                        <span class="cn-filter-chip" data-filter="char">角色</span>
                        <span class="cn-filter-chip" data-filter="hidden">隐藏</span>
                    </div>
                    <div class="cn-results" id="cn-results"></div>
                </div>

                <!-- 书签面板 -->
                <div class="cn-section" data-section="bookmark">
                    <div class="cn-bookmark-add">
                        <input type="text" id="cn-bm-id" placeholder="楼层号或区间，如 200 / 30-100" style="max-width:160px">
                        <input type="text" id="cn-bm-label" placeholder="书签名称">
                        <button class="cn-btn" id="cn-bm-add-btn">+</button>
                    </div>
                    <div id="cn-bookmarks-list"></div>
                </div>

                <!-- 导出面板 -->
                <div class="cn-section" data-section="export">
                    <div class="cn-input-group">
                        <input type="text" id="cn-export-range" placeholder="导出区间，如 0-100">
                    </div>
                    <div class="cn-export-format">
                        <span class="cn-filter-chip active" data-format="md">.md</span>
                        <span class="cn-filter-chip" data-format="txt">.txt</span>
                        <span class="cn-filter-chip" data-format="jsonl">.jsonl</span>
                    </div>
                    <div class="cn-quick-btns">
                        <button class="cn-btn" id="cn-export-btn">📥 导出文件</button>
                        <button class="cn-btn" id="cn-copy-btn">📋 复制</button>
                    </div>
                </div>
            </div>
            <div class="cn-position" id="cn-position">总楼层：-</div>
        </div>`;

        $('body').append(panelHTML);
        restoreTogglePosition();
        positionPanelNearToggle();
    }

    // ============ 事件绑定 ============

    function bindEvents() {
        // 面板开关
        $('#chat-navigator-toggle')
            .on('pointerdown', startToggleDrag)
            .on('click', function (e) {
                if (didDragToggle) {
                    e.preventDefault();
                    didDragToggle = false;
                    return;
                }
                togglePanel();
            });
        $('.cn-close').on('click', closePanel);
        $(window).on('resize', function () {
            keepToggleInViewport();
            positionPanelNearToggle();
        });

        // Tab 切换
        $('.cn-tab').on('click', function () {
            const tab = $(this).data('tab');
            $('.cn-tab').removeClass('active');
            $(this).addClass('active');
            $('.cn-section').removeClass('active');
            $(`.cn-section[data-section="${tab}"]`).addClass('active');
        });

        // 导航功能
        $('#cn-goto-btn').on('click', gotoFloor);
        $('#cn-goto-input').on('keydown', function (e) {
            if (e.key === 'Enter') gotoFloor();
        });
        $('#cn-range-btn').on('click', gotoRange);
        $('#cn-range-input').on('keydown', function (e) {
            if (e.key === 'Enter') gotoRange();
        });
        $('#cn-top-btn').on('click', gotoTop);
        $('#cn-bottom-btn').on('click', gotoBottom);

        // 搜索功能
        $('#cn-search-input').on('input', function () {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(performSearch, 300);
        });
        $('#cn-search-input').on('keydown', function (e) {
            if (e.key === 'Enter') {
                clearTimeout(searchDebounceTimer);
                performSearch();
            }
        });

        // 搜索过滤
        $('.cn-filter-row .cn-filter-chip').on('click', function () {
            $('.cn-filter-row .cn-filter-chip').removeClass('active');
            $(this).addClass('active');
            currentFilter = $(this).data('filter');
            performSearch();
        });

        // 书签
        $('#cn-bm-add-btn').on('click', addBookmark);
        $('#cn-bm-label').on('keydown', function (e) {
            if (e.key === 'Enter') addBookmark();
        });

        // 导出格式切换
        $('.cn-export-format .cn-filter-chip').on('click', function () {
            $('.cn-export-format .cn-filter-chip').removeClass('active');
            $(this).addClass('active');
            currentExportFormat = $(this).data('format');
        });

        // 导出按钮
        $('#cn-export-btn').on('click', exportRange);
        $('#cn-copy-btn').on('click', copyRange);

        // 监听聊天变化，更新楼层信息
        const context = SillyTavern.getContext();
        const { eventSource, event_types } = context;
        if (eventSource && event_types) {
            eventSource.on(event_types.CHAT_CHANGED, updatePosition);
            eventSource.on(event_types.MESSAGE_RECEIVED, updatePosition);
            eventSource.on(event_types.MESSAGE_SENT, updatePosition);
        }

        // 初始更新
        setTimeout(updatePosition, 500);
    }

    // ============ 面板控制 ============

    function togglePanel() {
        const panel = $('#chat-navigator-panel');
        const toggle = $('#chat-navigator-toggle');
        if (panel.hasClass('collapsed')) {
            panel.removeClass('collapsed');
            toggle.addClass('panel-open');
            positionPanelNearToggle();
            updatePosition();
            renderBookmarks();
        } else {
            closePanel();
        }
    }

    function closePanel() {
        $('#chat-navigator-panel').addClass('collapsed');
        $('#chat-navigator-toggle').removeClass('panel-open');
    }

    function restoreTogglePosition() {
        const toggle = $('#chat-navigator-toggle');
        const size = getToggleSize();
        const margin = 12;
        const saved = settings.buttonPosition;
        const left = saved && Number.isFinite(saved.left) ? saved.left : window.innerWidth - size.width - margin;
        const top = saved && Number.isFinite(saved.top) ? saved.top : Math.round(window.innerHeight * 0.58 - size.height / 2);
        setTogglePosition(left, top, false);
    }

    function startToggleDrag(e) {
        const originalEvent = e.originalEvent;
        if (!originalEvent) return;

        isDraggingToggle = true;
        didDragToggle = false;
        const toggle = $('#chat-navigator-toggle');
        const rect = toggle[0].getBoundingClientRect();
        dragStart = {
            x: originalEvent.clientX,
            y: originalEvent.clientY,
            left: rect.left,
            top: rect.top,
        };

        toggle.addClass('dragging');
        toggle[0].setPointerCapture?.(originalEvent.pointerId);
        $(document).on('pointermove.chatNavigator', dragToggle);
        $(document).on('pointerup.chatNavigator pointercancel.chatNavigator', stopToggleDrag);
    }

    function dragToggle(e) {
        if (!isDraggingToggle) return;
        const originalEvent = e.originalEvent;
        if (!originalEvent) return;

        const deltaX = originalEvent.clientX - dragStart.x;
        const deltaY = originalEvent.clientY - dragStart.y;
        if (Math.abs(deltaX) + Math.abs(deltaY) > 6) {
            didDragToggle = true;
        }

        setTogglePosition(dragStart.left + deltaX, dragStart.top + deltaY, false);
        positionPanelNearToggle();
    }

    function stopToggleDrag() {
        if (!isDraggingToggle) return;
        isDraggingToggle = false;
        $('#chat-navigator-toggle').removeClass('dragging');
        $(document).off('.chatNavigator');
        keepToggleInViewport();

        const rect = $('#chat-navigator-toggle')[0].getBoundingClientRect();
        settings.buttonPosition = { left: Math.round(rect.left), top: Math.round(rect.top) };
        saveSettings();
        positionPanelNearToggle();
    }

    function keepToggleInViewport() {
        const rect = $('#chat-navigator-toggle')[0].getBoundingClientRect();
        setTogglePosition(rect.left, rect.top, true);
    }

    function setTogglePosition(left, top, shouldSave) {
        const toggle = $('#chat-navigator-toggle');
        const size = getToggleSize();
        const margin = 8;
        const maxLeft = Math.max(margin, window.innerWidth - size.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - size.height - margin);
        const safeLeft = Math.min(Math.max(left, margin), maxLeft);
        const safeTop = Math.min(Math.max(top, margin), maxTop);

        toggle.css({ left: `${safeLeft}px`, top: `${safeTop}px` });

        if (shouldSave) {
            settings.buttonPosition = { left: Math.round(safeLeft), top: Math.round(safeTop) };
            saveSettings();
        }
    }

    function getToggleSize() {
        const toggle = $('#chat-navigator-toggle');
        return {
            width: toggle.outerWidth() || 52,
            height: toggle.outerHeight() || 52,
        };
    }

    function positionPanelNearToggle() {
        const panel = $('#chat-navigator-panel');
        const toggle = $('#chat-navigator-toggle');
        if (!panel.length || !toggle.length || panel.hasClass('collapsed')) return;

        const toggleRect = toggle[0].getBoundingClientRect();
        const panelWidth = Math.min(360, window.innerWidth - 20);
        const panelHeight = Math.min(panel.outerHeight() || 520, window.innerHeight - 20);
        const margin = 10;

        let left = toggleRect.left + toggleRect.width + margin;
        if (left + panelWidth > window.innerWidth - margin) {
            left = toggleRect.left - panelWidth - margin;
        }
        if (left < margin) {
            left = Math.min(Math.max(window.innerWidth - panelWidth - margin, margin), window.innerWidth - margin);
        }

        let top = toggleRect.top + toggleRect.height / 2 - panelHeight / 2;
        top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - panelHeight - margin));

        panel.css({ left: `${left}px`, top: `${top}px`, right: 'auto', bottom: 'auto' });
    }

    // ============ 核心功能：楼层跳转 ============

    function gotoFloor() {
        const input = $('#cn-goto-input').val().trim();
        const mesId = parseInt(input, 10);
        if (isNaN(mesId) || mesId < 0) {
            showToast('请输入有效的楼层号');
            return;
        }
        void scrollToMessage(mesId);
    }

    async function gotoRange() {
        const input = $('#cn-range-input').val().trim();
        const match = input.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (!match) {
            showToast('请输入有效区间，如 30-100');
            return;
        }
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        if (start > end) {
            showToast('起始楼层不能大于结束楼层');
            return;
        }

        const context = SillyTavern.getContext();
        const chat = context.chat;
        if (!chat || start >= chat.length) {
            showToast(`楼层 ${start} 超出范围（共 ${chat?.length ?? 0} 楼）`);
            return;
        }

        $('.cn-range-start, .cn-range-end').removeClass('cn-range-start cn-range-end');

        const jumped = await scrollToMessage(start);
        if (!jumped) return;

        const actualEnd = Math.min(end, chat.length - 1);
        setTimeout(() => {
            const startEl = $(`.mes[mesid="${start}"]`);
            const endEl = $(`.mes[mesid="${actualEnd}"]`);
            if (startEl.length) startEl.addClass('cn-range-start');
            if (endEl.length) endEl.addClass('cn-range-end');
        }, 120);
    }

    async function gotoTop() {
        $('.cn-range-start, .cn-range-end, .cn-highlight').removeClass('cn-range-start cn-range-end cn-highlight');

        const chatContainer = $('#chat');
        if (!chatContainer.length) {
            showToast('无法找到聊天区域');
            return;
        }

        const jumped = await scrollToMessage(0);
        if (jumped) return;

        for (let i = 0; i < 8; i++) {
            chatContainer.stop(true).scrollTop(0).trigger('scroll');
            await waitForRender(220);
            const firstMessage = findRenderedMessage(0);
            if (firstMessage.length) {
                scrollElementIntoView(firstMessage, true);
                return;
            }
        }

        showToast('已回到聊天顶部附近');
    }

    function gotoBottom() {
        const context = SillyTavern.getContext();
        const chat = context.chat;
        if (chat.length > 0) {
            void scrollToMessage(chat.length - 1);
        }
    }

    async function scrollToMessage(mesId) {
        const context = SillyTavern.getContext();
        const chat = context.chat || [];

        if (mesId < 0 || mesId >= chat.length) {
            showToast(`楼层 ${mesId} 不存在（共 ${chat.length} 楼，编号 0-${Math.max(0, chat.length - 1)}）`);
            return false;
        }

        $('.cn-highlight').removeClass('cn-highlight');

        let target = findRenderedMessage(mesId);
        if (target.length) {
            scrollElementIntoView(target, true);
            return true;
        }

        target = await jumpWithSillyTavernCommand(mesId);
        if (target.length) {
            scrollElementIntoView(target, true);
            return true;
        }

        target = await calibrateScrollToMessage(mesId);
        if (target.length) {
            scrollElementIntoView(target, true);
            return true;
        }

        const nearest = findNearestRenderedMessage(mesId);
        if (nearest.element.length) {
            scrollElementIntoView(nearest.element, true);
            showToast(`楼层 ${mesId} 暂未渲染，已定位到附近楼层 #${nearest.mesId}`);
            return false;
        }

        showToast(`无法定位楼层 ${mesId}`);
        return false;
    }

    function findRenderedMessage(mesId) {
        return $(`#chat .mes[mesid="${mesId}"]`);
    }

    async function jumpWithSillyTavernCommand(mesId) {
        const context = SillyTavern.getContext();
        if (typeof context.executeSlashCommands !== 'function') {
            return $();
        }

        try {
            await context.executeSlashCommands(`/chat-jump ${mesId}`);
            await waitForRender(220);
        } catch (error) {
            console.debug('[命途扉页] /chat-jump 不可用，改用自有跳转兜底', error);
        }

        return findRenderedMessage(mesId);
    }

    async function calibrateScrollToMessage(mesId) {
        const chatContainer = $('#chat');
        if (!chatContainer.length) return $();

        const maxAttempts = 18;
        let lastRangeKey = '';
        let stuckCount = 0;

        for (let i = 0; i < maxAttempts; i++) {
            const target = findRenderedMessage(mesId);
            if (target.length) return target;

            const range = getRenderedMessageRange();
            if (!range) {
                chatContainer.scrollTop(estimateScrollTopForMessage(mesId)).trigger('scroll');
                await waitForRender(180);
                continue;
            }

            const rangeKey = `${range.first}-${range.last}-${chatContainer.scrollTop()}`;
            stuckCount = rangeKey === lastRangeKey ? stuckCount + 1 : 0;
            lastRangeKey = rangeKey;

            if (mesId < range.first) {
                const nextTop = stuckCount >= 2 ? 0 : Math.max(0, chatContainer.scrollTop() - chatContainer.height() * 1.8);
                chatContainer.stop(true).scrollTop(nextTop).trigger('scroll');
            } else if (mesId > range.last) {
                const nextTop = chatContainer.scrollTop() + chatContainer.height() * 1.8;
                chatContainer.stop(true).scrollTop(nextTop).trigger('scroll');
            } else {
                chatContainer.stop(true).scrollTop(estimateScrollTopForMessage(mesId)).trigger('scroll');
            }

            await waitForRender(220);
        }

        return findRenderedMessage(mesId);
    }

    function getRenderedMessageRange() {
        const ids = $('#chat .mes').map(function () {
            return Number($(this).attr('mesid'));
        }).get().filter(id => Number.isFinite(id));

        if (!ids.length) return null;
        return {
            first: Math.min(...ids),
            last: Math.max(...ids),
        };
    }

    function findNearestRenderedMessage(mesId) {
        let nearest = { mesId: null, element: $(), distance: Number.MAX_SAFE_INTEGER };
        $('#chat .mes').each(function () {
            const currentId = Number($(this).attr('mesid'));
            if (!Number.isFinite(currentId)) return;

            const distance = Math.abs(currentId - mesId);
            if (distance < nearest.distance) {
                nearest = { mesId: currentId, element: $(this), distance };
            }
        });
        return nearest;
    }

    function estimateScrollTopForMessage(mesId) {
        const chatContainer = $('#chat');
        const total = Math.max(1, SillyTavern.getContext().chat?.length || 1);
        const ratio = Math.min(Math.max(mesId / total, 0), 1);
        return chatContainer[0].scrollHeight * ratio;
    }

    function scrollElementIntoView(messageEl, shouldHighlight) {
        const chatContainer = $('#chat');
        const targetTop = Math.max(0, messageEl[0].offsetTop - chatContainer[0].offsetTop - 24);
        chatContainer.stop(true).animate({
            scrollTop: targetTop,
        }, 250, function () {
            if (shouldHighlight) {
                messageEl.addClass('cn-highlight');
            }
        });
    }

    function waitForRender(delay = 180) {
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    // ============ 核心功能：搜索 ============

    function performSearch() {
        const query = $('#cn-search-input').val().trim();
        if (!query) {
            $('#cn-results').html('<div class="cn-no-results">输入关键词开始搜索</div>');
            return;
        }

        const context = SillyTavern.getContext();
        const chat = context.chat;

        if (!chat || chat.length === 0) {
            $('#cn-results').html('<div class="cn-no-results">当前没有聊天记录</div>');
            return;
        }

        searchResults = [];
        searchPage = 0;

        const queryLower = query.toLowerCase();
        const isDateQuery = /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(query);

        for (let i = 0; i < chat.length; i++) {
            const msg = chat[i];
            if (!msg) continue;

            if (currentFilter === 'user' && !msg.is_user) continue;
            if (currentFilter === 'char' && msg.is_user) continue;
            if (currentFilter === 'hidden' && !msg.is_system) continue;

            let matched = false;

            if (isDateQuery) {
                const sendDate = msg.send_date || '';
                if (sendDate.includes(query) || sendDate.includes(query.replace(/-/g, '/'))) {
                    matched = true;
                }
            } else {
                const content = String(msg.mes || '').toLowerCase();
                if (content.includes(queryLower)) {
                    matched = true;
                }
            }

            if (matched) {
                searchResults.push({
                    mesId: i,
                    isUser: msg.is_user || false,
                    isHidden: msg.is_system || false,
                    date: msg.send_date || '',
                    preview: String(msg.mes || '').substring(0, 80),
                });
            }
        }

        renderSearchResults();
    }

    function renderSearchResults() {
        const container = $('#cn-results');

        if (searchResults.length === 0) {
            container.html('<div class="cn-no-results">未找到匹配结果</div>');
            return;
        }

        const startIdx = 0;
        const endIdx = Math.min((searchPage + 1) * RESULTS_PER_PAGE, searchResults.length);
        const visibleResults = searchResults.slice(startIdx, endIdx);

        let html = `<div class="cn-results-info">找到 ${searchResults.length} 条结果</div>`;

        for (const result of visibleResults) {
            const hiddenClass = result.isHidden ? 'cn-result-hidden' : '';
            html += `
            <div class="cn-result-item ${hiddenClass}" data-mesid="${result.mesId}">
                <div class="cn-result-meta">
                    <span class="cn-result-id">#${result.mesId}</span>
                    <span class="cn-result-date">${formatDate(result.date)}</span>
                </div>
                <div class="cn-result-preview">${escapeHtml(result.preview)}</div>
            </div>`;
        }

        if (endIdx < searchResults.length) {
            html += `<div class="cn-load-more" id="cn-load-more">加载更多（还有 ${searchResults.length - endIdx} 条）</div>`;
        }

        container.html(html);

        // 绑定点击跳转
        container.find('.cn-result-item').on('click', function () {
            const mesId = parseInt($(this).data('mesid'), 10);
            scrollToMessage(mesId);
        });

        // 加载更多
        container.find('#cn-load-more').on('click', function () {
            searchPage++;
            renderSearchResults();
        });
    }

    // ============ 核心功能：书签 ============

    function getChatId() {
        const context = SillyTavern.getContext();
        // 用当前角色 + 聊天文件名做唯一标识
        const chatId = context.getCurrentChatId?.() || `${context.characterId}_${context.chatId}` || 'default';
        return String(chatId);
    }

    function getBookmarks() {
        const chatId = getChatId();
        if (!settings.bookmarks[chatId]) {
            settings.bookmarks[chatId] = [];
        }
        return settings.bookmarks[chatId];
    }

    function addBookmark() {
        const mesIdInput = $('#cn-bm-id').val().trim();
        const label = $('#cn-bm-label').val().trim();
        const context = SillyTavern.getContext();
        const chat = context.chat || [];

        if (!mesIdInput || !label) {
            showToast('请输入楼层号和书签名称');
            return;
        }

        const rangeMatch = mesIdInput.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        const bookmarks = getBookmarks();

        if (rangeMatch) {
            const start = parseInt(rangeMatch[1], 10);
            const end = parseInt(rangeMatch[2], 10);

            if (start > end) {
                showToast('区间书签起始楼层不能大于结束楼层');
                return;
            }

            if (start < 0 || end >= chat.length) {
                showToast(`楼层区间 ${start}-${end} 超出范围（共 ${chat.length} 楼）`);
                return;
            }

            const key = `range:${start}-${end}`;
            const existing = bookmarks.find(b => getBookmarkKey(b) === key);
            if (existing) {
                existing.label = label;
            } else {
                bookmarks.push({ type: 'range', start, end, label });
            }

            bookmarks.sort((a, b) => getBookmarkSortValue(a) - getBookmarkSortValue(b));
            saveSettings();
            renderBookmarks();
            $('#cn-bm-id').val('');
            $('#cn-bm-label').val('');
            showToast(`区间书签已添加：#${start}-${end} ${label}`);
            return;
        }

        const mesId = parseInt(mesIdInput, 10);
        if (isNaN(mesId) || mesId < 0) {
            showToast('楼层号无效');
            return;
        }

        if (mesId >= chat.length) {
            showToast(`楼层 ${mesId} 超出范围（共 ${chat.length} 楼）`);
            return;
        }

        const existing = bookmarks.find(b => getBookmarkKey(b) === `single:${mesId}`);
        if (existing) {
            existing.label = label;
        } else {
            bookmarks.push({ type: 'single', mesId, label });
        }

        bookmarks.sort((a, b) => getBookmarkSortValue(a) - getBookmarkSortValue(b));
        saveSettings();
        renderBookmarks();

        $('#cn-bm-id').val('');
        $('#cn-bm-label').val('');

        showToast(`书签已添加：#${mesId} ${label}`);
    }

    function deleteBookmarkByKey(key) {
        const chatId = getChatId();
        if (settings.bookmarks[chatId]) {
            settings.bookmarks[chatId] = settings.bookmarks[chatId].filter(b => getBookmarkKey(b) !== key);
            saveSettings();
            renderBookmarks();
        }
    }

    function getBookmarkKey(bookmark) {
        if (!bookmark) return '';
        if (bookmark.type === 'range') {
            return `range:${bookmark.start}-${bookmark.end}`;
        }
        if (typeof bookmark.start === 'number' && typeof bookmark.end === 'number') {
            return `range:${bookmark.start}-${bookmark.end}`;
        }
        const mesId = typeof bookmark.mesId === 'number' ? bookmark.mesId : bookmark.start;
        return `single:${mesId}`;
    }

    function getBookmarkSortValue(bookmark) {
        if (!bookmark) return 0;
        if (bookmark.type === 'range') return bookmark.start;
        if (typeof bookmark.start === 'number') return bookmark.start;
        return bookmark.mesId ?? 0;
    }

    function renderBookmarks() {
        const container = $('#cn-bookmarks-list');
        const bookmarks = getBookmarks();

        if (bookmarks.length === 0) {
            container.html('<div class="cn-bookmark-empty">暂无书签<br>在上方添加楼层号或区间来创建书签</div>');
            return;
        }

        let html = '';
        for (const bm of bookmarks) {
            const key = getBookmarkKey(bm);
            const isRange = bm.type === 'range' || (typeof bm.start === 'number' && typeof bm.end === 'number');
            const start = isRange ? (bm.start ?? bm.mesId) : (bm.mesId ?? bm.start);
            const end = isRange ? (bm.end ?? bm.start) : null;
            const floorText = isRange ? `#${start}-${end}` : `#${start}`;
            const jumpFloor = isRange ? start : start;
            const jumpEnd = isRange ? end : start;
            html += `
            <div class="cn-bookmark-item" data-key="${key}" data-start="${jumpFloor}" data-end="${jumpEnd}">
                <span class="cn-bookmark-id">${floorText}</span>
                <span class="cn-bookmark-label">${escapeHtml(bm.label)}</span>
                <span class="cn-bookmark-delete" data-key="${key}" title="取消收藏">✕</span>
            </div>`;
        }

        container.html(html);

        container.find('.cn-bookmark-item').on('click', function (e) {
            if ($(e.target).hasClass('cn-bookmark-delete')) return;
            const start = parseInt($(this).data('start'), 10);
            const end = parseInt($(this).data('end'), 10);
            if (!isNaN(end) && end !== start) {
                markRangeAndScroll(start, end);
                return;
            }
            scrollToMessage(start);
        });

        container.find('.cn-bookmark-delete').on('click', function (e) {
            e.stopPropagation();
            const key = String($(this).data('key'));
            deleteBookmarkByKey(key);
        });
    }

    async function markRangeAndScroll(start, end) {
        $('.cn-range-start, .cn-range-end').removeClass('cn-range-start cn-range-end');
        const jumped = await scrollToMessage(start);
        if (!jumped) return;

        setTimeout(() => {
            const startEl = $(`.mes[mesid="${start}"]`);
            const endEl = $(`.mes[mesid="${end}"]`);
            if (startEl.length) startEl.addClass('cn-range-start');
            if (endEl.length) endEl.addClass('cn-range-end');
        }, 180);
    }

    // ============ 核心功能：导出 ============

    function getExportRange() {
        const input = $('#cn-export-range').val().trim();
        const match = input.match(/^(\d+)\s*[-–—]\s*(\d+)$/);
        if (!match) {
            showToast('请输入有效的导出区间，如 0-100');
            return null;
        }
        const start = parseInt(match[1], 10);
        const end = parseInt(match[2], 10);
        if (start > end) {
            showToast('起始楼层不能大于结束楼层');
            return null;
        }
        return { start, end };
    }

    function buildExportContent(start, end) {
        const context = SillyTavern.getContext();
        const chat = context.chat;
        const actualEnd = Math.min(end, chat.length - 1);

        const messages = [];
        for (let i = start; i <= actualEnd; i++) {
            const msg = chat[i];
            if (!msg) continue;
            messages.push({
                id: i,
                name: msg.name || '未知',
                isUser: msg.is_user || false,
                isHidden: msg.is_system || false,
                date: msg.send_date || '',
                content: msg.mes || '',
            });
        }
        return messages;
    }

    function formatExport(messages, format) {
        if (format === 'jsonl') {
            return messages.map(m => JSON.stringify(m)).join('\n');
        }

        if (format === 'txt') {
            return messages.map(m => {
                const hidden = m.isHidden ? ' [隐藏]' : '';
                return `[#${m.id}] ${m.name}${hidden} (${formatDate(m.date)}):\n${m.content}\n`;
            }).join('\n---\n\n');
        }

        // md 格式
        let md = `# 聊天记录导出\n\n`;
        md += `> 区间：#${messages[0]?.id || 0} - #${messages[messages.length - 1]?.id || 0}  \n`;
        md += `> 导出时间：${new Date().toLocaleString()}\n\n---\n\n`;

        for (const m of messages) {
            const hidden = m.isHidden ? ' `[隐藏]`' : '';
            const role = m.isUser ? '👤' : '🤖';
            md += `### ${role} #${m.id} ${m.name}${hidden}\n`;
            md += `*${formatDate(m.date)}*\n\n`;
            md += `${m.content}\n\n---\n\n`;
        }

        return md;
    }

    function exportRange() {
        const range = getExportRange();
        if (!range) return;

        const messages = buildExportContent(range.start, range.end);
        if (messages.length === 0) {
            showToast('该区间没有消息');
            return;
        }

        const content = formatExport(messages, currentExportFormat);
        const ext = currentExportFormat;
        const filename = `chat_${range.start}-${range.end}.${ext}`;

        // 触发下载
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`已导出 ${messages.length} 条消息：${filename}`);
    }

    function copyRange() {
        const range = getExportRange();
        if (!range) return;

        const messages = buildExportContent(range.start, range.end);
        if (messages.length === 0) {
            showToast('该区间没有消息');
            return;
        }

        const content = formatExport(messages, currentExportFormat);

        navigator.clipboard.writeText(content).then(() => {
            showToast(`已复制 ${messages.length} 条消息到剪贴板`);
        }).catch(() => {
            showToast('复制失败，请手动复制');
        });
    }

    // ============ 辅助函数 ============

    function updatePosition() {
        const context = SillyTavern.getContext();
        const chat = context.chat;
        const total = chat ? chat.length : 0;
        const hidden = chat ? chat.filter(m => m && m.is_system).length : 0;
        $('#cn-position').text(`总楼层：${total}（隐藏：${hidden}）编号：0-${Math.max(0, total - 1)}`);
    }

    function showToast(message) {
        // 使用 ST 内置的 toastr 如果可用
        if (typeof toastr !== 'undefined') {
            toastr.info(message, '命途扉页');
        } else {
            console.log(`[命途扉页] ${message}`);
        }
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        // ST 的 send_date 格式通常是 "Month Day, Year HH:MM:SS" 或 ISO 格式
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr.substring(0, 10);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        } catch {
            return dateStr.substring(0, 10);
        }
    }

    // ============ 启动 ============

    // 等待 jQuery 和 ST 就绪
    if (typeof jQuery !== 'undefined') {
        $(document).ready(function () {
            init();
        });
    } else {
        window.addEventListener('load', init);
    }
})();
