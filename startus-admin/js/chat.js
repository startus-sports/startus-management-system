// --- 業務チャット (LINE風吹き出しUI + ファイル/リンク/編集/削除) ---

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';
import { showToast } from './app.js';
import { getStaffById, getStaffByEmail, getAllActiveStaff } from './staff.js';

// --- State ---

let currentView = 'channel-list';
let currentChannelId = null;
let channels = [];
let messages = [];
let currentStaff = null;
let realtimeSubscription = null;
let unreadCounts = {};
let isOpen = false;
let pollTimer = null;

// --- Slack UI State ---

let sectionCollapsed = { channels: false, dms: false };
let dmPartnerNames = {};
let dmPartnerIds = {};
let linkSearchTimeout = null;
let longPressTimer = null;
let replyToMsg = null;  // message object being replied to

// --- Constants ---

const MESSAGE_LIMIT = 50;
const POLL_INTERVAL = 30000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const AVATAR_COLORS = [
  '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#6366f1', '#14b8a6', '#f97316',
];

const REF_TYPE_MAP = {
  member:      { label: '会員',       icon: 'person' },
  application: { label: '申請',       icon: 'description' },
  trial:       { label: '体験',       icon: 'sports' },
  transfer:    { label: '振替',       icon: 'swap_horiz' },
  staff:       { label: 'スタッフ',   icon: 'badge' },
  classroom:   { label: '教室',       icon: 'school' },
};

// ===== Avatar Helpers =====

function getInitials(name) {
  if (!name) return '?';
  const trimmed = name.trim();
  if (/^[a-zA-Z]/.test(trimmed)) {
    return trimmed.split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }
  return trimmed.charAt(0);
}

function getAvatarColor(staffId) {
  if (!staffId) return AVATAR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < staffId.length; i++) {
    hash = staffId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function renderAvatar(staffId, size = 32) {
  const staff = getStaffById(staffId);
  const name = staff ? staff.name : '?';
  const initials = getInitials(name);
  const color = getAvatarColor(staffId);
  const fontSize = size <= 24 ? '0.65rem' : '0.8rem';
  return `<div class="chat-avatar" style="width:${size}px;height:${size}px;background:${color};font-size:${fontSize}">${escapeHtml(initials)}</div>`;
}

// ===== Date / Time Helpers =====

function formatDateSeparator(isoStr) {
  const d = new Date(isoStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - msgDay) / 86400000);
  if (diffDays === 0) return '今日';
  if (diffDays === 1) return '昨日';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const dd = d.getDate();
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  if (y === now.getFullYear()) return `${m}月${dd}日（${weekday}）`;
  return `${y}年${m}月${dd}日（${weekday}）`;
}

function formatChatTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  const now = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `${hh}:${mm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
}

// ===== File Helpers =====

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(mimeType) {
  if (!mimeType) return 'description';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('pdf')) return 'picture_as_pdf';
  if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'table_chart';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'article';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return 'slideshow';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'folder_zip';
  return 'description';
}

// ===== Message Grouping =====

function groupMessages(msgs) {
  if (!msgs || msgs.length === 0) return [];
  const result = [];
  let prevSenderId = null;
  let prevDate = null;
  let prevTimestamp = null;

  for (const msg of msgs) {
    const msgDate = new Date(msg.created_at);
    const dateStr = msgDate.toDateString();

    if (dateStr !== prevDate) {
      result.push({ type: 'date-separator', date: msg.created_at, label: formatDateSeparator(msg.created_at) });
      prevSenderId = null;
    }

    if (msg.message_type === 'system' || msg.message_type === 'task' || msg.is_deleted) {
      result.push({ type: 'message', msg, grouped: false });
      prevSenderId = null;
      prevDate = dateStr;
      prevTimestamp = msgDate;
      continue;
    }

    const timeDiff = prevTimestamp ? (msgDate - prevTimestamp) / 60000 : Infinity;
    const isGrouped = msg.sender_id === prevSenderId && dateStr === prevDate && timeDiff < 5;
    result.push({ type: 'message', msg, grouped: isGrouped });

    prevSenderId = msg.sender_id;
    prevDate = dateStr;
    prevTimestamp = msgDate;
  }
  return result;
}

// ===== Section Collapse =====

function loadSectionState() {
  try {
    const saved = localStorage.getItem('chat-section-collapsed');
    if (saved) sectionCollapsed = JSON.parse(saved);
  } catch (e) { /* ignore */ }
}

function toggleSection(key) {
  sectionCollapsed[key] = !sectionCollapsed[key];
  localStorage.setItem('chat-section-collapsed', JSON.stringify(sectionCollapsed));
  renderChannelList();
}

// ===== Init / Destroy =====

export async function initChat(staffInfo) {
  currentStaff = staffInfo;
  if (!currentStaff) { console.warn('initChat: スタッフ情報がありません'); return; }
  loadSectionState();
  await loadChannels();
  await ensureSelfChannel();
  await ensureGroupMembership();
  await loadUnreadCounts();
  updateUnreadBadge();
  subscribeRealtime();
}

export function destroyChat() {
  unsubscribeRealtime();
  stopPollingFallback();
  currentStaff = null;
  channels = [];
  messages = [];
  unreadCounts = {};
  isOpen = false;
}

// ===== Toggle Sidebar =====

export function toggleChat() {
  isOpen = !isOpen;
  const sidebar = document.getElementById('chat-sidebar');
  const overlay = document.getElementById('chat-sidebar-overlay');
  const fab = document.getElementById('chat-fab');
  if (sidebar) sidebar.classList.toggle('open', isOpen);
  if (overlay) overlay.classList.toggle('active', isOpen);
  if (fab) fab.classList.toggle('chat-fab-hidden', isOpen);
  if (isOpen) {
    if (currentView === 'channel-list') renderChannelList();
    else renderMessageThread();
  }
}

// ===== Channel Navigation =====

export async function openChannel(channelId) {
  replyToMsg = null;
  currentChannelId = channelId;
  currentView = 'message-thread';
  await loadMessages(channelId);
  await markAsRead(channelId);
  unreadCounts[channelId] = 0;
  updateUnreadBadge();
  renderMessageThread();
  scrollToBottom();
}

export function backToChannelList() {
  replyToMsg = null;
  currentView = 'channel-list';
  currentChannelId = null;
  messages = [];
  // Render immediately with cached data
  renderChannelList();
  updateUnreadBadge();
  // Update data in background
  loadChannels().then(() => {
    renderChannelList();
    loadUnreadCounts().then(() => { renderChannelList(); updateUnreadBadge(); });
  });
}

// ===== Send Message =====

export async function sendMessage() {
  if (!currentStaff || !currentChannelId) return;
  const input = document.getElementById('chat-message-input');
  if (!input) return;
  const body = input.value.trim();
  if (!body) return;
  input.value = '';
  input.style.height = 'auto';
  input.focus();

  const metadata = replyToMsg ? { reply_to_id: replyToMsg.id } : null;
  replyToMsg = null;
  removeReplyPreviewBar();

  const insertObj = {
    channel_id: currentChannelId, sender_id: currentStaff.id, message_type: 'text', body,
  };
  if (metadata) insertObj.metadata = metadata;

  const { data: inserted, error } = await supabase.from('chat_messages').insert(insertObj).select().single();

  if (error) {
    console.error('メッセージ送信エラー:', error);
    showToast('送信に失敗しました', 'error');
    input.value = body;
    return;
  }
  if (inserted && !messages.find(m => m.id === inserted.id)) {
    messages.push(inserted);
    appendMessageToThread(inserted);
    scrollToBottom();
    markAsRead(currentChannelId);
  }
}

export async function sendTaskMessage(targetStaffId, refType, refId, refLabel, body) {
  if (!currentStaff) return;
  let channelId;
  if (targetStaffId) {
    channelId = await ensureDmChannel(targetStaffId);
  } else {
    const group = channels.find(c => c.slug === 'jimukyoku');
    if (!group) return;
    channelId = group.id;
  }
  if (!channelId) return;
  const { error } = await supabase.from('chat_messages').insert({
    channel_id: channelId, sender_id: currentStaff.id, message_type: 'task', body,
    metadata: { ref_type: refType, ref_id: refId, ref_label: refLabel, action: 'assign' },
  });
  if (error) console.error('タスクメッセージ送信エラー:', error);
}

// ===== Open Reference from Chat =====

export function openRefFromChat(refType, refId) {
  // Close chat panel so the detail view is visible
  if (isOpen) toggleChat();
  if (refType === 'member') window.memberApp.showDetail(refId);
  else if (refType === 'application') window.memberApp.showApplicationDetail(refId);
  else if (refType === 'trial') window.memberApp.showTrialDetail(refId);
  else if (refType === 'transfer') window.memberApp.showTransferDetail(refId);
  else if (refType === 'staff') window.memberApp.showStaffDetail(refId);
  else if (refType === 'classroom') window.memberApp.switchTab('master');
}

// ===== Open DM with Staff =====

export async function openDmWithStaff(staffId) {
  const channelId = await ensureDmChannel(staffId);
  if (channelId) {
    if (!isOpen) toggleChat();
    await openChannel(channelId);
  }
}

// ===== Data Loading =====

async function loadChannels() {
  if (!currentStaff) return;
  const { data: memberships, error: memErr } = await supabase
    .from('chat_channel_members').select('channel_id').eq('staff_id', currentStaff.id);
  if (memErr) { console.error('chat_channel_members 取得エラー:', memErr); channels = []; return; }
  if (!memberships || memberships.length === 0) { channels = []; return; }
  const channelIds = memberships.map(m => m.channel_id);
  const { data, error: chErr } = await supabase
    .from('chat_channels').select('*').in('id', channelIds).order('created_at', { ascending: true });
  if (chErr) console.error('chat_channels 取得エラー:', chErr);
  channels = data || [];
  await loadDmPartnerNames();
}

async function loadMessages(channelId) {
  const { data } = await supabase.from('chat_messages').select('*')
    .eq('channel_id', channelId).order('created_at', { ascending: true }).limit(MESSAGE_LIMIT);
  messages = data || [];
}

async function markAsRead(channelId) {
  if (!currentStaff) return;
  await supabase.from('chat_channel_members')
    .update({ last_read_at: new Date().toISOString() })
    .eq('channel_id', channelId).eq('staff_id', currentStaff.id);
}

export async function loadUnreadCounts() {
  if (!currentStaff) return;
  const { data: memberships } = await supabase.from('chat_channel_members')
    .select('channel_id, last_read_at').eq('staff_id', currentStaff.id);
  if (!memberships) return;
  const counts = {};
  for (const m of memberships) {
    const { count } = await supabase.from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('channel_id', m.channel_id).gt('created_at', m.last_read_at).neq('sender_id', currentStaff.id);
    counts[m.channel_id] = count || 0;
  }
  unreadCounts = counts;
}

// ===== Channel Management =====

async function ensureSelfChannel() {
  if (!currentStaff) return;
  const slug = `self-${currentStaff.id}`;
  if (channels.find(c => c.slug === slug)) return;
  const { data: existingChannel, error: selfErr } = await supabase
    .from('chat_channels').select('id').eq('slug', slug).single();
  if (selfErr && selfErr.code !== 'PGRST116') console.error('self channel 検索エラー:', selfErr);
  let channelId;
  if (existingChannel) { channelId = existingChannel.id; }
  else {
    const { data: newChannel } = await supabase.from('chat_channels')
      .insert({ type: 'self', name: '自分メモ', slug, created_by: currentStaff.id }).select().single();
    if (!newChannel) return;
    channelId = newChannel.id;
  }
  await supabase.from('chat_channel_members').upsert({ channel_id: channelId, staff_id: currentStaff.id }, { onConflict: 'channel_id,staff_id' });
  await loadChannels();
}

async function ensureGroupMembership() {
  if (!currentStaff) return;
  const { data: groupChannel, error: grpErr } = await supabase
    .from('chat_channels').select('id').eq('slug', 'jimukyoku').single();
  if (grpErr) console.error('jimukyoku channel 検索エラー:', grpErr);
  if (!groupChannel) return;
  await supabase.from('chat_channel_members').upsert({ channel_id: groupChannel.id, staff_id: currentStaff.id }, { onConflict: 'channel_id,staff_id' });
  await loadChannels();
}

async function ensureDmChannel(otherStaffId) {
  if (!currentStaff || otherStaffId === currentStaff.id) return null;
  const myDms = channels.filter(c => c.type === 'dm');
  for (const dm of myDms) {
    const { data: otherMember } = await supabase.from('chat_channel_members')
      .select('staff_id').eq('channel_id', dm.id).eq('staff_id', otherStaffId).single();
    if (otherMember) return dm.id;
  }
  const { data: newChannel } = await supabase.from('chat_channels')
    .insert({ type: 'dm', name: '', slug: '', created_by: currentStaff.id }).select().single();
  if (!newChannel) return null;
  await supabase.from('chat_channel_members').insert([
    { channel_id: newChannel.id, staff_id: currentStaff.id },
    { channel_id: newChannel.id, staff_id: otherStaffId },
  ]);
  await loadChannels();
  return newChannel.id;
}

// ===== DM Partner Cache =====

async function loadDmPartnerNames() {
  if (!currentStaff) return;
  for (const ch of channels.filter(c => c.type === 'dm')) {
    const { data: members } = await supabase.from('chat_channel_members')
      .select('staff_id').eq('channel_id', ch.id).neq('staff_id', currentStaff.id);
    if (members && members.length > 0) {
      const partner = getStaffById(members[0].staff_id);
      dmPartnerNames[ch.id] = partner ? partner.name : '不明';
      dmPartnerIds[ch.id] = members[0].staff_id;
    }
  }
}

function getChannelDisplayName(ch) {
  if (ch.type === 'group') return ch.name || 'グループ';
  if (ch.type === 'self') return '自分メモ';
  if (ch.type === 'dm') return dmPartnerNames[ch.id] || 'DM';
  return ch.name || 'チャット';
}

// ===== Realtime =====

function subscribeRealtime() {
  unsubscribeRealtime();
  realtimeSubscription = supabase
    .channel('chat-messages-rt')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, handleNewMessage)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' }, handleUpdatedMessage)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') stopPollingFallback();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Chat realtime failed, using polling fallback');
        startPollingFallback();
      }
    });
}

function unsubscribeRealtime() {
  if (realtimeSubscription) { supabase.removeChannel(realtimeSubscription); realtimeSubscription = null; }
}

function handleNewMessage(payload) {
  const msg = payload.new;
  if (!msg || !currentStaff) return;
  const myChannelIds = channels.map(c => c.id);
  if (!myChannelIds.includes(msg.channel_id)) {
    loadChannels().then(() => {
      if (channels.map(c => c.id).includes(msg.channel_id)) {
        unreadCounts[msg.channel_id] = (unreadCounts[msg.channel_id] || 0) + 1;
        updateUnreadBadge();
        if (msg.sender_id !== currentStaff.id) showChatNotification(msg);
        if (currentView === 'channel-list' && isOpen) renderChannelList();
      }
    });
    return;
  }
  if (msg.channel_id === currentChannelId && isOpen) {
    if (messages.find(m => m.id === msg.id)) return;
    messages.push(msg);
    appendMessageToThread(msg);
    scrollToBottom();
    markAsRead(msg.channel_id);
  } else {
    if (msg.sender_id !== currentStaff.id) {
      unreadCounts[msg.channel_id] = (unreadCounts[msg.channel_id] || 0) + 1;
      updateUnreadBadge();
      showChatNotification(msg);
    }
    if (currentView === 'channel-list' && isOpen) renderChannelList();
  }
}

// ===== Chat Notification Toast =====

let notifTimeout = null;
let pendingNotifs = [];

function showChatNotification(msg) {
  // Batch notifications within 2s window
  pendingNotifs.push(msg);
  if (notifTimeout) clearTimeout(notifTimeout);
  notifTimeout = setTimeout(() => flushChatNotifications(), 2000);
}

function flushChatNotifications() {
  notifTimeout = null;
  const batch = pendingNotifs.splice(0);
  if (batch.length === 0) return;

  // Group by channel
  const byChannel = {};
  for (const m of batch) {
    if (!byChannel[m.channel_id]) byChannel[m.channel_id] = [];
    byChannel[m.channel_id].push(m);
  }

  for (const [channelId, msgs] of Object.entries(byChannel)) {
    const ch = channels.find(c => c.id === channelId);
    const channelName = ch ? getChannelDisplayName(ch) : 'チャット';
    const count = unreadCounts[channelId] || msgs.length;
    const lastMsg = msgs[msgs.length - 1];

    // Build preview text
    const sender = getStaffById(lastMsg.sender_id);
    const senderName = sender ? sender.name : '不明';
    let preview = '';
    if (lastMsg.message_type === 'file') preview = '📎 ファイルを送信';
    else if (lastMsg.message_type === 'link') preview = '🔗 業務リンクを共有';
    else if (lastMsg.message_type === 'task') preview = '📋 タスクを送信';
    else preview = (lastMsg.body || '').substring(0, 40) + ((lastMsg.body || '').length > 40 ? '…' : '');

    // Create notification toast
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast toast-chat-notif';
    toast.style.cursor = 'pointer';
    toast.onclick = () => {
      toast.remove();
      if (!isOpen) {
        const fab = document.getElementById('chat-fab');
        if (fab) fab.click();
      }
      setTimeout(() => openChannel(channelId), 200);
    };

    toast.innerHTML = `
      <div class="chat-notif-header">
        <span class="material-icons chat-notif-icon">chat</span>
        <span class="chat-notif-channel">${escapeHtml(channelName)}</span>
        ${count > 1 ? `<span class="chat-notif-badge">${count}</span>` : ''}
      </div>
      <div class="chat-notif-body">
        <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(preview)}
      </div>
    `;
    container.appendChild(toast);

    // Auto-dismiss after 5s
    setTimeout(() => {
      toast.classList.add('toast-hide');
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }
}

function handleUpdatedMessage(payload) {
  const updated = payload.new;
  if (!updated || !currentStaff) return;
  if (updated.channel_id !== currentChannelId) return;

  const idx = messages.findIndex(m => m.id === updated.id);
  if (idx === -1) return;
  messages[idx] = updated;

  // Re-render the specific message element
  const el = document.querySelector(`[data-msg-id="${updated.id}"]`);
  if (el) {
    const grouped = groupMessages(messages);
    const item = grouped.find(g => g.type === 'message' && g.msg.id === updated.id);
    if (item) {
      const div = document.createElement('div');
      div.innerHTML = renderSlackMessage(item.msg, item.grouped);
      const newEl = div.firstElementChild;
      if (newEl) {
        el.replaceWith(newEl);
        attachContextMenu(newEl);
      }
    }
  }
}

// ===== Polling Fallback =====

function startPollingFallback() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    await loadUnreadCounts();
    updateUnreadBadge();
    if (isOpen && currentView === 'message-thread' && currentChannelId) {
      await loadMessages(currentChannelId);
      renderMessageThread();
    }
  }, POLL_INTERVAL);
}

function stopPollingFallback() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ===== Rendering: Channel List =====

function renderChannelList() {
  const body = document.getElementById('chat-sidebar-body');
  const title = document.getElementById('chat-sidebar-title');
  const backBtn = document.getElementById('chat-back-btn');
  if (!body) return;
  if (title) title.textContent = 'チャット';
  if (backBtn) backBtn.style.display = 'none';

  const selfChannel = channels.find(c => c.type === 'self');
  const groupChannels = channels.filter(c => c.type === 'group');
  const dmChannels = channels.filter(c => c.type === 'dm');

  let html = '';
  if (selfChannel) {
    const unread = unreadCounts[selfChannel.id] || 0;
    html += `
      <div class="chat-pinned-item ${currentChannelId === selfChannel.id ? 'chat-channel-active' : ''} ${unread > 0 ? 'chat-channel-unread' : ''}"
           onclick="window.memberApp.chatOpenChannel('${selfChannel.id}')">
        <span class="material-icons" style="font-size:18px;color:var(--gray-400)">bookmark</span>
        <span class="chat-channel-name">自分メモ</span>
        ${unread > 0 ? `<span class="chat-unread-dot">${unread}</span>` : ''}
      </div>`;
  }
  html += renderSection('channels', 'チャンネル', groupChannels);
  html += renderSection('dms', 'ダイレクトメッセージ', dmChannels, true);
  body.innerHTML = `<div class="chat-channel-list">${html}</div>`;
}

function renderSection(key, label, items, showAddBtn = false) {
  const collapsed = sectionCollapsed[key];
  const chevron = collapsed ? 'chevron_right' : 'expand_more';
  const addBtnHtml = showAddBtn
    ? `<button class="chat-new-dm-btn" onclick="event.stopPropagation();window.memberApp.chatShowNewDmPicker()" title="新しいメッセージ"><span class="material-icons">add</span></button>` : '';

  const itemsHtml = items.map(ch => {
    const unread = unreadCounts[ch.id] || 0;
    const displayName = getChannelDisplayName(ch);
    const isActive = ch.id === currentChannelId;
    if (ch.type === 'group') {
      return `<div class="chat-channel-item ${isActive ? 'chat-channel-active' : ''} ${unread > 0 ? 'chat-channel-unread' : ''}"
             onclick="window.memberApp.chatOpenChannel('${ch.id}')">
          <span class="chat-channel-hash">#</span>
          <span class="chat-channel-name">${escapeHtml(displayName)}</span>
          ${unread > 0 ? `<span class="chat-unread-dot">${unread}</span>` : ''}
        </div>`;
    }
    const partnerId = dmPartnerIds[ch.id];
    return `<div class="chat-channel-item ${isActive ? 'chat-channel-active' : ''} ${unread > 0 ? 'chat-channel-unread' : ''}"
           onclick="window.memberApp.chatOpenChannel('${ch.id}')">
        ${renderAvatar(partnerId, 24)}
        <span class="chat-channel-name">${escapeHtml(displayName)}</span>
        ${unread > 0 ? `<span class="chat-unread-dot">${unread}</span>` : ''}
      </div>`;
  }).join('');

  return `<div class="chat-section">
      <div class="chat-section-header ${collapsed ? 'collapsed' : ''}" onclick="window.memberApp.chatToggleSection('${key}')">
        <span class="material-icons chat-section-chevron">${chevron}</span>
        <span class="chat-section-label">${label}</span>${addBtnHtml}
      </div>
      <div class="chat-section-items ${collapsed ? 'collapsed' : ''}">
        ${itemsHtml || '<div class="chat-section-empty">なし</div>'}
      </div>
    </div>`;
}

// ===== Rendering: Message Thread =====

function renderMessageThread() {
  const body = document.getElementById('chat-sidebar-body');
  const title = document.getElementById('chat-sidebar-title');
  const backBtn = document.getElementById('chat-back-btn');
  if (!body) return;

  const channel = channels.find(c => c.id === currentChannelId);
  const channelName = channel ? getChannelDisplayName(channel) : 'チャット';
  if (title) title.textContent = channelName;
  if (backBtn) backBtn.style.display = '';

  const grouped = groupMessages(messages);
  const messagesHtml = grouped.map(item => {
    if (item.type === 'date-separator') return `<div class="chat-date-separator"><span>${escapeHtml(item.label)}</span></div>`;
    return renderSlackMessage(item.msg, item.grouped);
  }).join('');

  const placeholder = channel ? `メッセージを送信 ${channel.type === 'group' ? '#' : ''}${channelName}` : 'メッセージを入力...';

  body.innerHTML = `
    <div class="chat-thread-container">
      <div class="chat-messages-scroll" id="chat-messages-scroll">
        ${messagesHtml || '<div class="chat-empty">メッセージがありません</div>'}
      </div>
      <div class="chat-input-area">
        <div class="chat-input-container">
          <div class="chat-input-toolbar">
            <button class="chat-toolbar-btn" title="ファイル添付" onclick="window.memberApp.chatAttachFile()">
              <span class="material-icons">attach_file</span>
            </button>
            <button class="chat-toolbar-btn" title="業務リンク" onclick="window.memberApp.chatOpenLinkPicker()">
              <span class="material-icons">link</span>
            </button>
          </div>
          <textarea id="chat-message-input" class="chat-input" rows="1"
            placeholder="${escapeHtml(placeholder)}"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();window.memberApp.chatSendMessage()}"></textarea>
          <button class="chat-send-btn" onclick="window.memberApp.chatSendMessage()">
            <span class="material-icons">send</span>
          </button>
        </div>
      </div>
    </div>`;

  const textarea = document.getElementById('chat-message-input');
  if (textarea) {
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    });
  }
  bindContextMenuEvents();
  scrollToBottom();
}

function bindContextMenuEvents() {
  const scroll = document.getElementById('chat-messages-scroll');
  if (!scroll) return;
  scroll.querySelectorAll('.chat-msg[data-msg-id]').forEach(el => {
    attachContextMenu(el);
  });
}

function attachContextMenu(el) {
  const msgId = el.dataset.msgId;
  if (!msgId) return;

  // Right-click (desktop)
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showChatContextMenu(msgId, e.clientX, e.clientY);
  });

  // Long-press (mobile)
  el.addEventListener('touchstart', (e) => {
    longPressTimer = setTimeout(() => {
      const touch = e.touches[0];
      showChatContextMenu(msgId, touch.clientX, touch.clientY);
    }, 500);
  }, { passive: true });

  el.addEventListener('touchend', () => {
    clearTimeout(longPressTimer);
  });

  el.addEventListener('touchmove', () => {
    clearTimeout(longPressTimer);
  });
}

// ===== Context Menu =====

function showChatContextMenu(msgId, x, y) {
  closeChatContextMenu();
  const msg = messages.find(m => m.id === msgId);
  if (!msg || msg.is_deleted || msg.message_type === 'system') return;

  const isOwn = msg.sender_id === currentStaff?.id;
  const isText = msg.message_type === 'text';
  const isCopyable = ['text', 'task', 'link', 'file'].includes(msg.message_type);

  let items = '';
  // リプライ — all non-system messages
  items += `<div class="chat-ctx-item" onclick="window.memberApp.chatCtxReply('${msgId}')">
    <span class="material-icons">reply</span><span>リプライ</span></div>`;
  // コピー — text, task, link, file
  if (isCopyable) {
    items += `<div class="chat-ctx-item" onclick="window.memberApp.chatCtxCopy('${msgId}')">
      <span class="material-icons">content_copy</span><span>コピー</span></div>`;
  }
  // 転送 — all message types
  items += `<div class="chat-ctx-item" onclick="window.memberApp.chatCtxForward('${msgId}')">
    <span class="material-icons">forward</span><span>転送</span></div>`;
  // 編集 — own text only
  if (isOwn && isText) {
    items += `<div class="chat-ctx-item" onclick="window.memberApp.chatCtxEdit('${msgId}')">
      <span class="material-icons">edit</span><span>編集</span></div>`;
  }
  // 削除 — own messages only
  if (isOwn) {
    items += `<div class="chat-ctx-item chat-ctx-item--danger" onclick="window.memberApp.chatCtxDelete('${msgId}')">
      <span class="material-icons">delete</span><span>削除</span></div>`;
  }

  const menu = document.createElement('div');
  menu.className = 'chat-context-menu';
  menu.id = 'chat-context-menu';
  menu.innerHTML = items;
  document.body.appendChild(menu);

  // Position — keep within viewport
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    let left = x, top = y;
    if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
    if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
    if (left < 0) left = 8;
    if (top < 0) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.opacity = '1';
  });

  // Close on outside click
  setTimeout(() => {
    document.addEventListener('click', closeChatContextMenu, { once: true });
    document.addEventListener('contextmenu', closeChatContextMenu, { once: true });
  }, 0);
}

function closeChatContextMenu() {
  const menu = document.getElementById('chat-context-menu');
  if (menu) menu.remove();
}

function chatCtxCopy(msgId) {
  closeChatContextMenu();
  const msg = messages.find(m => m.id === msgId);
  if (!msg) return;

  let text = msg.body || '';
  const meta = msg.metadata || {};
  if (msg.message_type === 'task') {
    text = `[${meta.ref_label || ''}] ${msg.body}`;
  } else if (msg.message_type === 'link') {
    const info = REF_TYPE_MAP[meta.ref_type] || { label: '' };
    text = `[${info.label}] ${meta.ref_label || msg.body}`;
  } else if (msg.message_type === 'file') {
    text = meta.file_url || meta.file_name || msg.body;
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast('コピーしました');
  }).catch(() => {
    showToast('コピーに失敗しました', 'error');
  });
}

function chatCtxReply(msgId) {
  closeChatContextMenu();
  const msg = messages.find(m => m.id === msgId);
  if (!msg) return;
  replyToMsg = msg;
  showReplyPreviewBar();
  const input = document.getElementById('chat-message-input');
  if (input) input.focus();
}

function showReplyPreviewBar() {
  removeReplyPreviewBar();
  if (!replyToMsg) return;
  const inputArea = document.querySelector('.chat-input-area');
  if (!inputArea) return;

  const sender = getStaffById(replyToMsg.sender_id);
  const senderName = sender ? sender.name : '不明';
  let bodyPreview = '';
  if (replyToMsg.message_type === 'file') bodyPreview = '📎 ファイル';
  else if (replyToMsg.message_type === 'link') bodyPreview = '🔗 業務リンク';
  else if (replyToMsg.message_type === 'task') bodyPreview = '📋 タスク';
  else bodyPreview = (replyToMsg.body || '').substring(0, 50) + ((replyToMsg.body || '').length > 50 ? '…' : '');

  const bar = document.createElement('div');
  bar.className = 'chat-reply-bar';
  bar.id = 'chat-reply-bar';
  bar.innerHTML = `
    <div class="chat-reply-bar-content">
      <span class="material-icons" style="font-size:16px;color:var(--primary-color)">reply</span>
      <div class="chat-reply-bar-text">
        <span class="chat-reply-bar-name">${escapeHtml(senderName)}</span>
        <span class="chat-reply-bar-body">${escapeHtml(bodyPreview)}</span>
      </div>
    </div>
    <button class="btn-icon" onclick="window.memberApp.chatCancelReply()"><span class="material-icons" style="font-size:18px">close</span></button>`;
  inputArea.insertBefore(bar, inputArea.firstChild);
}

function removeReplyPreviewBar() {
  const bar = document.getElementById('chat-reply-bar');
  if (bar) bar.remove();
}

function chatCancelReply() {
  replyToMsg = null;
  removeReplyPreviewBar();
}

function chatCtxEdit(msgId) {
  closeChatContextMenu();
  chatEditMessage(msgId);
}

function chatCtxDelete(msgId) {
  closeChatContextMenu();
  chatDeleteMessage(msgId);
}

// ===== Forward Message =====

let forwardMsgId = null;

function chatCtxForward(msgId) {
  closeChatContextMenu();
  forwardMsgId = msgId;
  showForwardPicker();
}

function showForwardPicker() {
  chatCloseForwardPicker();
  const overlay = document.createElement('div');
  overlay.className = 'chat-forward-overlay';
  overlay.id = 'chat-forward-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) chatCloseForwardPicker(); };

  const selfChannel = channels.find(c => c.type === 'self');
  const groupChannels = channels.filter(c => c.type === 'group');
  const dmChannels = channels.filter(c => c.type === 'dm');

  let listHtml = '';
  if (selfChannel) {
    listHtml += `<div class="chat-forward-item" onclick="window.memberApp.chatForwardTo('${selfChannel.id}')">
      <span class="material-icons" style="font-size:20px;color:var(--gray-400)">bookmark</span>
      <span>自分メモ</span></div>`;
  }
  for (const ch of groupChannels) {
    listHtml += `<div class="chat-forward-item" onclick="window.memberApp.chatForwardTo('${ch.id}')">
      <span class="chat-channel-hash" style="font-size:16px">#</span>
      <span>${escapeHtml(ch.name || 'グループ')}</span></div>`;
  }
  for (const ch of dmChannels) {
    const name = dmPartnerNames[ch.id] || 'DM';
    const partnerId = dmPartnerIds[ch.id];
    listHtml += `<div class="chat-forward-item" onclick="window.memberApp.chatForwardTo('${ch.id}')">
      ${renderAvatar(partnerId, 24)}
      <span>${escapeHtml(name)}</span></div>`;
  }

  overlay.innerHTML = `<div class="chat-forward-picker">
    <div class="chat-forward-picker-header">
      <span>転送先を選択</span>
      <button class="btn-icon" onclick="window.memberApp.chatCloseForwardPicker()"><span class="material-icons">close</span></button>
    </div>
    <div class="chat-forward-picker-body">${listHtml || '<div class="chat-empty">チャンネルがありません</div>'}</div>
  </div>`;
  document.body.appendChild(overlay);
}

function chatCloseForwardPicker() {
  const overlay = document.getElementById('chat-forward-overlay');
  if (overlay) overlay.remove();
}

async function chatForwardTo(channelId) {
  chatCloseForwardPicker();
  const msg = messages.find(m => m.id === forwardMsgId);
  if (!msg || !currentStaff) { forwardMsgId = null; return; }

  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';

  // Build forwarded message based on type
  let body, messageType, metadata;
  if (msg.message_type === 'file') {
    body = msg.body;
    messageType = 'file';
    metadata = { ...msg.metadata, forwarded_from: senderName };
  } else if (msg.message_type === 'link') {
    body = msg.body;
    messageType = 'link';
    metadata = { ...msg.metadata, forwarded_from: senderName };
  } else if (msg.message_type === 'task') {
    body = msg.body;
    messageType = 'task';
    metadata = { ...msg.metadata, forwarded_from: senderName };
  } else {
    // text — send as text with forwarded prefix
    body = `【転送: ${senderName}】\n${msg.body}`;
    messageType = 'text';
    metadata = { forwarded_from: senderName };
  }

  const { data: inserted, error } = await supabase.from('chat_messages').insert({
    channel_id: channelId, sender_id: currentStaff.id,
    message_type: messageType, body, metadata,
  }).select().single();

  if (error) {
    console.error('転送エラー:', error);
    showToast('転送に失敗しました', 'error');
  } else {
    // If forwarded to current channel, append immediately
    if (channelId === currentChannelId && inserted && !messages.find(m => m.id === inserted.id)) {
      messages.push(inserted);
      appendMessageToThread(inserted);
      scrollToBottom();
      markAsRead(channelId);
    }
    const destChannel = channels.find(c => c.id === channelId);
    const destName = destChannel ? getChannelDisplayName(destChannel) : 'チャット';
    showToast(`${destName} に転送しました`);
  }
  forwardMsgId = null;
}

function renderReplyPreview(msg) {
  const meta = msg.metadata || {};
  if (!meta.reply_to_id) return '';
  const orig = messages.find(m => m.id === meta.reply_to_id);
  if (!orig) return '';
  const origSender = getStaffById(orig.sender_id);
  const origName = origSender ? origSender.name : '不明';
  let origBody = '';
  if (orig.is_deleted) origBody = 'このメッセージは削除されました';
  else if (orig.message_type === 'file') origBody = '📎 ファイル';
  else if (orig.message_type === 'link') origBody = '🔗 業務リンク';
  else if (orig.message_type === 'task') origBody = '📋 タスク';
  else origBody = (orig.body || '').substring(0, 50) + ((orig.body || '').length > 50 ? '…' : '');
  return `<div class="chat-reply-preview">
    <span class="chat-reply-name">${escapeHtml(origName)}</span>
    <span class="chat-reply-body">${escapeHtml(origBody)}</span>
  </div>`;
}

function renderSlackMessage(msg, isGrouped) {
  if (msg.is_deleted) return renderDeletedMessage(msg, isGrouped);
  if (msg.message_type === 'system') return renderSystemDivider(msg);
  if (msg.message_type === 'task') return renderTaskCard(msg);
  if (msg.message_type === 'file') return renderFileMessage(msg, isGrouped);
  if (msg.message_type === 'link') return renderLinkCard(msg, isGrouped);

  const isOwn = msg.sender_id === currentStaff?.id;
  const ownClass = isOwn ? ' chat-msg--own' : '';
  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';
  const time = formatChatTime(msg.created_at);
  const replyHtml = renderReplyPreview(msg);

  const editedTag = msg.edited_at ? '<span class="chat-msg-edited">(編集済み)</span>' : '';

  if (isGrouped) {
    return `<div class="chat-msg chat-msg--grouped${ownClass}" data-msg-id="${msg.id}">
        <div class="chat-msg-bubble">
          ${replyHtml}
          <div class="chat-msg-body">${escapeHtml(msg.body).replace(/\n/g, '<br>')}${editedTag}</div>
        </div>
        <span class="chat-msg-hover-time">${time}</span>
      </div>`;
  }

  const avatarHtml = isOwn ? '' : `<div class="chat-msg-avatar">${renderAvatar(msg.sender_id, 32)}</div>`;

  return `<div class="chat-msg${ownClass}" data-msg-id="${msg.id}">
      ${avatarHtml}
      <div class="chat-msg-bubble-wrap">
        ${!isOwn ? `<span class="chat-msg-sender">${escapeHtml(senderName)}</span>` : ''}
        <div class="chat-msg-bubble">
          ${replyHtml}
          <div class="chat-msg-body">${escapeHtml(msg.body).replace(/\n/g, '<br>')}${editedTag}</div>
        </div>
        <span class="chat-msg-time">${time}</span>
      </div>
    </div>`;
}

function renderDeletedMessage(msg, isGrouped) {
  const isOwn = msg.sender_id === currentStaff?.id;
  const ownClass = isOwn ? ' chat-msg--own' : '';
  const time = formatChatTime(msg.created_at);

  if (isGrouped) {
    return `<div class="chat-msg chat-msg--grouped chat-msg--deleted${ownClass}" data-msg-id="${msg.id}">
        <div class="chat-msg-bubble chat-msg-bubble--deleted">
          <div class="chat-msg-body chat-msg-deleted-text">このメッセージは削除されました</div>
        </div>
      </div>`;
  }

  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';
  const avatarHtml = isOwn ? '' : `<div class="chat-msg-avatar">${renderAvatar(msg.sender_id, 32)}</div>`;

  return `<div class="chat-msg chat-msg--deleted${ownClass}" data-msg-id="${msg.id}">
      ${avatarHtml}
      <div class="chat-msg-bubble-wrap">
        ${!isOwn ? `<span class="chat-msg-sender">${escapeHtml(senderName)}</span>` : ''}
        <div class="chat-msg-bubble chat-msg-bubble--deleted">
          <div class="chat-msg-body chat-msg-deleted-text">このメッセージは削除されました</div>
        </div>
        <span class="chat-msg-time">${time}</span>
      </div>
    </div>`;
}

function renderTaskCard(msg) {
  const meta = msg.metadata || {};
  const isOwn = msg.sender_id === currentStaff?.id;
  const ownClass = isOwn ? ' chat-msg--own' : '';
  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';
  const time = formatChatTime(msg.created_at);
  const replyHtml = renderReplyPreview(msg);
  const avatarHtml = isOwn ? '' : `<div class="chat-msg-avatar">${renderAvatar(msg.sender_id, 32)}</div>`;

  return `<div class="chat-msg${ownClass}" data-msg-id="${msg.id}">
      ${avatarHtml}
      <div class="chat-msg-bubble-wrap">
        ${!isOwn ? `<span class="chat-msg-sender">${escapeHtml(senderName)}</span>` : ''}
        <div class="chat-msg-bubble">
          ${replyHtml}
          <div class="chat-task-card">
            <div class="chat-task-header">
              <span class="material-icons" style="font-size:18px;color:var(--primary-color)">assignment</span>
              <span class="chat-task-label">${escapeHtml(meta.ref_label || '')}</span>
            </div>
            <div class="chat-task-body">${escapeHtml(msg.body)}</div>
            ${meta.ref_type && meta.ref_id ? `<button class="btn btn-secondary chat-task-btn" onclick="window.memberApp.openRefFromChat('${escapeHtml(meta.ref_type)}','${escapeHtml(meta.ref_id)}')"><span class="material-icons" style="font-size:16px">open_in_new</span>詳細を開く</button>` : ''}
          </div>
        </div>
        <span class="chat-msg-time">${time}</span>
      </div>
    </div>`;
}

function renderFileMessage(msg, isGrouped) {
  const meta = msg.metadata || {};
  const isImage = meta.file_type && meta.file_type.startsWith('image/');
  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';
  const time = formatChatTime(msg.created_at);

  let fileContent;
  if (isImage) {
    fileContent = `<div class="chat-file-image" onclick="window.open('${escapeHtml(meta.file_url)}','_blank')">
        <img src="${escapeHtml(meta.file_url)}" alt="${escapeHtml(meta.file_name || '')}" loading="lazy">
      </div>`;
  } else {
    fileContent = `<a class="chat-file-card" href="${escapeHtml(meta.file_url)}" target="_blank" rel="noopener">
        <span class="material-icons chat-file-icon">${getFileIcon(meta.file_type)}</span>
        <div class="chat-file-info">
          <span class="chat-file-name">${escapeHtml(meta.file_name || 'ファイル')}</span>
          <span class="chat-file-size">${formatFileSize(meta.file_size)}</span>
        </div>
        <span class="material-icons chat-file-download">download</span>
      </a>`;
  }

  const isOwn = msg.sender_id === currentStaff?.id;
  const ownClass = isOwn ? ' chat-msg--own' : '';
  const replyHtml = renderReplyPreview(msg);

  if (isGrouped) {
    return `<div class="chat-msg chat-msg--grouped${ownClass}" data-msg-id="${msg.id}">
        <div class="chat-msg-bubble">
          ${replyHtml}
          ${fileContent}
        </div>
        <span class="chat-msg-hover-time">${time}</span>
      </div>`;
  }
  const avatarHtml = isOwn ? '' : `<div class="chat-msg-avatar">${renderAvatar(msg.sender_id, 32)}</div>`;
  return `<div class="chat-msg${ownClass}" data-msg-id="${msg.id}">
      ${avatarHtml}
      <div class="chat-msg-bubble-wrap">
        ${!isOwn ? `<span class="chat-msg-sender">${escapeHtml(senderName)}</span>` : ''}
        <div class="chat-msg-bubble">
          ${replyHtml}
          ${fileContent}
        </div>
        <span class="chat-msg-time">${time}</span>
      </div>
    </div>`;
}

function renderLinkCard(msg, isGrouped) {
  const meta = msg.metadata || {};
  const sender = getStaffById(msg.sender_id);
  const senderName = sender ? sender.name : '不明';
  const time = formatChatTime(msg.created_at);
  const info = REF_TYPE_MAP[meta.ref_type] || { label: '', icon: 'link' };
  const isOwn = msg.sender_id === currentStaff?.id;
  const ownClass = isOwn ? ' chat-msg--own' : '';
  const replyHtml = renderReplyPreview(msg);

  const linkContent = `<div class="chat-link-card" onclick="window.memberApp.openRefFromChat('${escapeHtml(meta.ref_type || '')}','${escapeHtml(meta.ref_id || '')}')">
      <div class="chat-link-card-icon"><span class="material-icons">${info.icon}</span></div>
      <div class="chat-link-card-info">
        <span class="chat-link-card-type">${escapeHtml(info.label)}</span>
        <span class="chat-link-card-label">${escapeHtml(meta.ref_label || '')}</span>
      </div>
      <span class="material-icons" style="font-size:16px;color:var(--gray-400);flex-shrink:0">open_in_new</span>
    </div>`;

  if (isGrouped) {
    return `<div class="chat-msg chat-msg--grouped${ownClass}" data-msg-id="${msg.id}">
        <div class="chat-msg-bubble">
          ${replyHtml}
          ${linkContent}
        </div>
        <span class="chat-msg-hover-time">${time}</span>
      </div>`;
  }
  const avatarHtml = isOwn ? '' : `<div class="chat-msg-avatar">${renderAvatar(msg.sender_id, 32)}</div>`;
  return `<div class="chat-msg${ownClass}" data-msg-id="${msg.id}">
      ${avatarHtml}
      <div class="chat-msg-bubble-wrap">
        ${!isOwn ? `<span class="chat-msg-sender">${escapeHtml(senderName)}</span>` : ''}
        <div class="chat-msg-bubble">
          ${replyHtml}
          ${linkContent}
        </div>
        <span class="chat-msg-time">${time}</span>
      </div>
    </div>`;
}

function renderSystemDivider(msg) {
  return `<div class="chat-system-divider" data-msg-id="${msg.id}"><span>${escapeHtml(msg.body)}</span></div>`;
}

// ===== Append Message (Realtime) =====

function appendMessageToThread(msg) {
  const scroll = document.getElementById('chat-messages-scroll');
  if (!scroll) return;
  const empty = scroll.querySelector('.chat-empty');
  if (empty) empty.remove();

  const prevMsg = messages.length >= 2 ? messages[messages.length - 2] : null;
  const msgDate = new Date(msg.created_at);
  const prevDate = prevMsg ? new Date(prevMsg.created_at) : null;

  if (!prevDate || msgDate.toDateString() !== prevDate.toDateString()) {
    const sep = document.createElement('div');
    sep.className = 'chat-date-separator';
    sep.innerHTML = `<span>${escapeHtml(formatDateSeparator(msg.created_at))}</span>`;
    scroll.appendChild(sep);
  }

  let isGrouped = false;
  if (prevMsg && msg.message_type === 'text' && prevMsg.message_type === 'text' &&
      msg.sender_id === prevMsg.sender_id && !prevMsg.is_deleted &&
      prevDate && msgDate.toDateString() === prevDate.toDateString() && (msgDate - prevDate) / 60000 < 5) {
    isGrouped = true;
  }

  const div = document.createElement('div');
  div.innerHTML = renderSlackMessage(msg, isGrouped);
  const msgEl = div.firstElementChild;
  if (msgEl) {
    scroll.appendChild(msgEl);
    attachContextMenu(msgEl);
  }
}

function scrollToBottom() {
  setTimeout(() => {
    const scroll = document.getElementById('chat-messages-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }, 50);
}

// ===== Unread Badge =====

export function updateUnreadBadge() {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;
  const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
  if (total > 0) { badge.textContent = total > 99 ? '99+' : String(total); badge.style.display = 'flex'; }
  else { badge.style.display = 'none'; }
}

// ===== Message Edit =====

function chatEditMessage(msgId) {
  const msg = messages.find(m => m.id === msgId);
  if (!msg || msg.sender_id !== currentStaff?.id || msg.message_type !== 'text') return;
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const bodyEl = el.querySelector('.chat-msg-body');
  if (!bodyEl) return;

  bodyEl.outerHTML = `<div class="chat-msg-body chat-msg-editing">
    <textarea class="chat-edit-textarea" id="chat-edit-${msgId}">${escapeHtml(msg.body)}</textarea>
    <div class="chat-edit-actions">
      <button class="btn btn-secondary btn-sm" onclick="window.memberApp.chatCancelEdit('${msgId}')">キャンセル</button>
      <button class="btn btn-primary btn-sm" onclick="window.memberApp.chatSaveEdit('${msgId}')">保存</button>
    </div>
    <div class="chat-edit-hint">Escでキャンセル・Ctrl+Enterで保存</div>
  </div>`;

  // Hide actions during editing
  const actionsEl = el.querySelector('.chat-msg-actions');
  if (actionsEl) actionsEl.style.display = 'none';

  const textarea = document.getElementById(`chat-edit-${msgId}`);
  if (textarea) {
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') chatCancelEdit(msgId);
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); chatSaveEdit(msgId); }
    });
  }
}

async function chatSaveEdit(msgId) {
  const textarea = document.getElementById(`chat-edit-${msgId}`);
  if (!textarea) return;
  const newBody = textarea.value.trim();
  if (!newBody) { showToast('メッセージを入力してください', 'error'); return; }

  const { error } = await supabase.from('chat_messages')
    .update({ body: newBody, edited_at: new Date().toISOString() }).eq('id', msgId);
  if (error) { console.error('編集エラー:', error); showToast('編集に失敗しました', 'error'); return; }

  const msg = messages.find(m => m.id === msgId);
  if (msg) { msg.body = newBody; msg.edited_at = new Date().toISOString(); }

  reRenderMessage(msgId);
}

function chatCancelEdit(msgId) {
  reRenderMessage(msgId);
}

function reRenderMessage(msgId) {
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const grouped = groupMessages(messages);
  const item = grouped.find(g => g.type === 'message' && g.msg.id === msgId);
  if (!item) return;
  const div = document.createElement('div');
  div.innerHTML = renderSlackMessage(item.msg, item.grouped);
  const newEl = div.firstElementChild;
  if (newEl) {
    el.replaceWith(newEl);
    attachContextMenu(newEl);
  }
}

// ===== Message Delete =====

function chatDeleteMessage(msgId) {
  const msg = messages.find(m => m.id === msgId);
  if (!msg || msg.sender_id !== currentStaff?.id) return;
  const el = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!el) return;
  const bodyEl = el.querySelector('.chat-msg-body') || el.querySelector('.chat-task-card') || el.querySelector('.chat-file-image') || el.querySelector('.chat-file-card') || el.querySelector('.chat-link-card');
  if (!bodyEl) return;

  const origHtml = bodyEl.outerHTML;
  bodyEl.outerHTML = `<div class="chat-delete-confirm">
    <span>このメッセージを削除しますか？</span>
    <div class="chat-delete-actions">
      <button class="btn btn-secondary btn-sm" onclick="window.memberApp.chatCancelDelete('${msgId}')">キャンセル</button>
      <button class="btn btn-danger btn-sm" onclick="window.memberApp.chatConfirmDelete('${msgId}')">削除する</button>
    </div>
  </div>`;

  // Store for cancel restore
  el.dataset.origHtml = origHtml;
  const actionsEl = el.querySelector('.chat-msg-actions');
  if (actionsEl) actionsEl.style.display = 'none';
}

async function chatConfirmDelete(msgId) {
  const { error } = await supabase.from('chat_messages').update({ is_deleted: true }).eq('id', msgId);
  if (error) { console.error('削除エラー:', error); showToast('削除に失敗しました', 'error'); return; }
  const msg = messages.find(m => m.id === msgId);
  if (msg) msg.is_deleted = true;
  reRenderMessage(msgId);
}

function chatCancelDelete(msgId) {
  reRenderMessage(msgId);
}

// ===== File Upload =====

function chatAttachFile() {
  const input = document.getElementById('chat-file-input');
  if (!input) return;
  input.value = '';
  input.onchange = handleFileSelected;
  input.click();
}

async function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;

  if (file.size > MAX_FILE_SIZE) {
    showToast('ファイルサイズは5MB以下にしてください', 'error');
    return;
  }
  if (!currentStaff || !currentChannelId) return;

  showUploadProgress();
  const path = `${currentChannelId}/${Date.now()}_${file.name}`;

  try {
    const { error: uploadError } = await supabase.storage.from('chat-attachments').upload(path, file);
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from('chat-attachments').getPublicUrl(path);
    const fileUrl = urlData.publicUrl;

    const { data: inserted, error: msgError } = await supabase.from('chat_messages').insert({
      channel_id: currentChannelId, sender_id: currentStaff.id, message_type: 'file', body: file.name,
      metadata: { file_url: fileUrl, file_name: file.name, file_size: file.size, file_type: file.type },
    }).select().single();

    if (msgError) throw msgError;
    if (inserted && !messages.find(m => m.id === inserted.id)) {
      messages.push(inserted);
      appendMessageToThread(inserted);
      scrollToBottom();
      markAsRead(currentChannelId);
    }
  } catch (err) {
    console.error('ファイルアップロードエラー:', err);
    showToast('ファイルのアップロードに失敗しました', 'error');
  } finally {
    hideUploadProgress();
  }
}

function showUploadProgress() {
  const inputArea = document.querySelector('.chat-input-area');
  if (!inputArea) return;
  const bar = document.createElement('div');
  bar.className = 'chat-upload-progress';
  bar.id = 'chat-upload-progress';
  bar.innerHTML = `<div class="chat-upload-progress-bar"></div><span class="chat-upload-progress-text">アップロード中...</span>`;
  inputArea.insertBefore(bar, inputArea.firstChild);
}

function hideUploadProgress() {
  const bar = document.getElementById('chat-upload-progress');
  if (bar) bar.remove();
}

// ===== Business Link Picker =====

function chatOpenLinkPicker() {
  const body = document.getElementById('chat-sidebar-body');
  if (!body) return;
  const existing = document.getElementById('chat-link-picker');
  if (existing) { existing.remove(); return; }

  const categories = Object.entries(REF_TYPE_MAP).map(([key, val]) =>
    `<button class="chat-link-category-btn" onclick="window.memberApp.chatSelectLinkCategory('${key}')">
      <span class="material-icons">${val.icon}</span><span>${val.label}</span>
    </button>`
  ).join('');

  const picker = document.createElement('div');
  picker.className = 'chat-link-picker';
  picker.id = 'chat-link-picker';
  picker.innerHTML = `
    <div class="chat-link-picker-header">
      <span>業務リンクを挿入</span>
      <button class="btn-icon" onclick="window.memberApp.chatCloseLinkPicker()"><span class="material-icons">close</span></button>
    </div>
    <div class="chat-link-picker-body" id="chat-link-picker-body">
      <div class="chat-link-categories">${categories}</div>
    </div>`;
  body.appendChild(picker);
}

function chatCloseLinkPicker() {
  const picker = document.getElementById('chat-link-picker');
  if (picker) picker.remove();
}

function chatLinkPickerBack() {
  const pickerBody = document.getElementById('chat-link-picker-body');
  if (!pickerBody) return;
  const categories = Object.entries(REF_TYPE_MAP).map(([key, val]) =>
    `<button class="chat-link-category-btn" onclick="window.memberApp.chatSelectLinkCategory('${key}')">
      <span class="material-icons">${val.icon}</span><span>${val.label}</span>
    </button>`
  ).join('');
  pickerBody.innerHTML = `<div class="chat-link-categories">${categories}</div>`;
}

async function chatSelectLinkCategory(category) {
  const pickerBody = document.getElementById('chat-link-picker-body');
  if (!pickerBody) return;
  const info = REF_TYPE_MAP[category] || { label: category, icon: 'link' };

  pickerBody.innerHTML = `
    <div class="chat-link-search-header">
      <button class="btn-icon" onclick="window.memberApp.chatLinkPickerBack()"><span class="material-icons">arrow_back</span></button>
      <span>${info.label}を検索</span>
    </div>
    <div class="chat-link-search-input-wrap">
      <input type="text" id="chat-link-search-input" class="chat-link-search-input"
        placeholder="名前で検索..." oninput="window.memberApp.chatSearchLinkRecords('${category}',this.value)">
    </div>
    <div id="chat-link-search-results" class="chat-link-search-results">
      <div class="chat-empty" style="padding:20px">読み込み中...</div>
    </div>`;

  await doSearchLinkRecords(category, '');
  const input = document.getElementById('chat-link-search-input');
  if (input) input.focus();
}

function chatSearchLinkRecords(category, query) {
  clearTimeout(linkSearchTimeout);
  linkSearchTimeout = setTimeout(() => doSearchLinkRecords(category, query), 300);
}

async function doSearchLinkRecords(category, query) {
  const resultsEl = document.getElementById('chat-link-search-results');
  if (!resultsEl) return;
  let records = [];
  const q = query.trim();

  try {
    switch (category) {
      case 'member': {
        let qb = supabase.from('members').select('id, name, member_number').order('name').limit(30);
        if (q) qb = qb.ilike('name', `%${q}%`);
        const { data } = await qb;
        records = (data || []).map(r => ({ id: r.id, label: `${r.name}${r.member_number ? ` (${r.member_number})` : ''}`, icon: 'person' }));
        break;
      }
      case 'application': {
        const { data } = await supabase.from('applications').select('id, form_data, type, status').order('created_at', { ascending: false }).limit(30);
        records = (data || []).filter(r => !q || (r.form_data?.name || '').includes(q))
          .map(r => ({ id: r.id, label: `${r.form_data?.name || '名前なし'} (${r.type || ''}) [${r.status}]`, icon: 'description' }));
        break;
      }
      case 'trial': {
        const { data } = await supabase.from('trials').select('id, form_data, status').order('created_at', { ascending: false }).limit(30);
        records = (data || []).filter(r => !q || (r.form_data?.child_name || r.form_data?.name || '').includes(q))
          .map(r => ({ id: r.id, label: `${r.form_data?.child_name || r.form_data?.name || '名前なし'} [${r.status}]`, icon: 'sports' }));
        break;
      }
      case 'transfer': {
        let qb = supabase.from('transfers').select('id, member_name, status, from_class, to_class').order('created_at', { ascending: false }).limit(30);
        if (q) qb = qb.ilike('member_name', `%${q}%`);
        const { data } = await qb;
        records = (data || []).map(r => ({ id: r.id, label: `${r.member_name || '不明'} (${r.from_class}→${r.to_class}) [${r.status}]`, icon: 'swap_horiz' }));
        break;
      }
      case 'staff': {
        let qb = supabase.from('staff').select('id, name, role').eq('status', '在籍').order('name').limit(30);
        if (q) qb = qb.ilike('name', `%${q}%`);
        const { data } = await qb;
        records = (data || []).map(r => ({ id: r.id, label: `${r.name} (${r.role})`, icon: 'badge' }));
        break;
      }
      case 'classroom': {
        let qb = supabase.from('classrooms').select('id, name, day_of_week').order('name').limit(30);
        if (q) qb = qb.ilike('name', `%${q}%`);
        const { data } = await qb;
        records = (data || []).map(r => ({ id: r.id, label: `${r.name}${r.day_of_week ? ` (${r.day_of_week})` : ''}`, icon: 'school' }));
        break;
      }
    }
  } catch (err) { console.error('リンク検索エラー:', err); }

  if (records.length === 0) { resultsEl.innerHTML = '<div class="chat-empty" style="padding:20px">該当なし</div>'; return; }

  resultsEl.innerHTML = records.map(r => {
    const safeLabel = escapeHtml(r.label).replace(/'/g, '&#39;');
    return `<div class="chat-link-result-item" onclick="window.memberApp.chatSendLinkMessage('${category}','${r.id}','${safeLabel}')">
        <span class="material-icons" style="font-size:18px;color:var(--gray-400)">${r.icon}</span>
        <span class="chat-link-result-label">${escapeHtml(r.label)}</span>
        <span class="material-icons" style="font-size:16px;color:var(--gray-300)">send</span>
      </div>`;
  }).join('');
}

async function chatSendLinkMessage(refType, refId, refLabel) {
  if (!currentStaff || !currentChannelId) return;
  chatCloseLinkPicker();

  const { data: inserted, error } = await supabase.from('chat_messages').insert({
    channel_id: currentChannelId, sender_id: currentStaff.id, message_type: 'link', body: refLabel,
    metadata: { ref_type: refType, ref_id: refId, ref_label: refLabel },
  }).select().single();

  if (error) { console.error('リンク送信エラー:', error); showToast('リンクの送信に失敗しました', 'error'); return; }
  if (inserted && !messages.find(m => m.id === inserted.id)) {
    messages.push(inserted);
    appendMessageToThread(inserted);
    scrollToBottom();
    markAsRead(currentChannelId);
  }
}

// ===== New DM Picker =====

function showNewDmPicker() {
  const body = document.getElementById('chat-sidebar-body');
  if (!body) return;
  const existing = document.getElementById('chat-dm-modal');
  if (existing) { existing.remove(); return; }
  const allStaff = getAllActiveStaff();
  const existingPartnerIds = Object.values(dmPartnerIds);
  const staffItems = allStaff.filter(s => s.id !== currentStaff?.id).map(s => {
    const hasDm = existingPartnerIds.includes(s.id);
    return `<div class="chat-dm-picker-item" onclick="window.memberApp.chatStartDm('${s.id}')">
        ${renderAvatar(s.id, 32)}
        <span class="chat-dm-picker-name">${escapeHtml(s.name)}</span>
        ${hasDm ? '<span class="material-icons" style="font-size:14px;color:var(--gray-400)">chat</span>' : ''}
      </div>`;
  }).join('');

  const picker = document.createElement('div');
  picker.className = 'chat-dm-modal';
  picker.id = 'chat-dm-modal';
  picker.innerHTML = `
    <div class="chat-dm-modal-header">
      <span>新しいメッセージ</span>
      <button class="btn-icon" onclick="window.memberApp.chatHideNewDmPicker()"><span class="material-icons">close</span></button>
    </div>
    <div class="chat-dm-modal-body">${staffItems || '<div class="chat-empty">スタッフがいません</div>'}</div>`;
  body.appendChild(picker);
}

function hideNewDmPicker() {
  const picker = document.getElementById('chat-dm-modal');
  if (picker) picker.remove();
}

async function startDm(staffId) {
  hideNewDmPicker();
  await openDmWithStaff(staffId);
}

// ===== Exported aliases for window.memberApp =====

export const chatOpenChannel = (id) => openChannel(id);
export const chatBackToList = () => backToChannelList();
export const chatSendMessage = () => sendMessage();
export const chatToggleSection = (key) => toggleSection(key);
export const chatShowNewDmPicker = () => showNewDmPicker();
export const chatHideNewDmPicker = () => hideNewDmPicker();
export const chatStartDm = (staffId) => startDm(staffId);

// New feature exports
export { chatEditMessage, chatSaveEdit, chatCancelEdit };
export { chatDeleteMessage, chatConfirmDelete, chatCancelDelete };
export { chatAttachFile };
export { chatOpenLinkPicker, chatCloseLinkPicker, chatSelectLinkCategory, chatSearchLinkRecords, chatSendLinkMessage, chatLinkPickerBack };
export { chatCtxCopy, chatCtxEdit, chatCtxDelete, chatCtxForward, chatCtxReply };
export { chatForwardTo, chatCloseForwardPicker };
export { chatCancelReply };
