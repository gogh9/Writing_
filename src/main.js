import { createClient } from '@supabase/supabase-js';

// =========================================================================
// 1. SUPABASE CLIENT INITIALIZATION
// =========================================================================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseAnonKey && supabaseUrl !== 'your_supabase_project_url') {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// Global state variables
let currentUser = null;
let currentUserEmail = null;
let currentRole = null;
let selectedTopicId = null;
let selectedTopicTitle = null;
let selectedTopicGuide = null;
let selectedStudentData = null;
let currentTeacherTopicId = null;
let currentStar = 0;
let autoSaveTimer = null;
let toastTimer = null;

// =========================================================================
// 2. DATABASE SERVICE LAYER (Supabase + LocalStorage Fallback)
// =========================================================================
const DB = {
  isSupabaseConfigured() {
    return supabase !== null;
  },

  // Student Authentication via email lookup
  async checkStudentRegistration(email) {
    if (!this.isSupabaseConfigured()) {
      // Fallback to localStorage if Supabase is not configured
      const localStudents = JSON.parse(localStorage.getItem('students_list')) || [];
      return { valid: true, name: email.split('@')[0] }; // Mock registration success
    }

    try {
      const { data, error } = await supabase
        .from('students')
        .select('name')
        .eq('email', email)
        .maybeSingle();

      if (error) throw error;
      if (data) {
        return { valid: true, name: data.name };
      }

      // Check if it's the configured teacher email
      const teacherEmail = localStorage.getItem('teacher_email') || 'gogh9@susaek.sen.es.kr';
      if (teacherEmail === email) {
        return { valid: true, name: '선생님', isTeacher: true };
      }

      return { valid: false };
    } catch (e) {
      console.error('Registration check failed:', e);
      return { valid: false, error: e.message };
    }
  },

  async getStudentList() {
    if (!this.isSupabaseConfigured()) {
      return JSON.parse(localStorage.getItem('students_list')) || [];
    }
    const { data, error } = await supabase
      .from('students')
      .select('name, email, parent_code')
      .order('name', { ascending: true });

    if (error) {
      console.error(error);
      return [];
    }
    return data;
  },

  async saveStudentList(studentsArray) {
    // studentsArray is array of objects { email, name, parent_code }
    if (!this.isSupabaseConfigured()) {
      const names = studentsArray.map(s => s.name);
      localStorage.setItem('students_list', JSON.stringify(names));
      return { success: true, message: '로컬 스토리지에 학생 이름 목록이 저장되었습니다.' };
    }

    try {
      // Upsert student list
      const { error } = await supabase
        .from('students')
        .upsert(studentsArray, { onConflict: 'email' });

      if (error) throw error;
      return { success: true, message: '학생 목록이 Supabase에 성공적으로 저장되었습니다.' };
    } catch (e) {
      return { success: false, message: '오류: ' + e.message };
    }
  },

  async getTopicList() {
    if (!this.isSupabaseConfigured()) {
      return JSON.parse(localStorage.getItem('topic_list')) || [];
    }
    const { data, error } = await supabase
      .from('topics')
      .select('*')
      .order('id', { ascending: true });

    if (error) {
      console.error(error);
      return [];
    }
    return data;
  },

  async addTopic(title, guide) {
    const topics = await this.getTopicList();
    const nextNum = topics.length + 1;
    const id = "T" + (nextNum < 10 ? "00" + nextNum : nextNum < 100 ? "0" + nextNum : "" + nextNum);
    const now = new Date();
    const dateStr = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}.`;

    if (!this.isSupabaseConfigured()) {
      topics.push({ id, title, guide, date: dateStr });
      localStorage.setItem('topic_list', JSON.stringify(topics));
      return { success: true, message: '주제가 로컬에 추가되었습니다.', id };
    }

    try {
      const { error } = await supabase
        .from('topics')
        .insert([{ id, title, guide, date: dateStr }]);

      if (error) throw error;
      return { success: true, message: '주제가 추가되었습니다.', id };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async updateTopic(topicId, title, guide) {
    if (!this.isSupabaseConfigured()) {
      const topics = await this.getTopicList();
      const idx = topics.findIndex(t => t.id === topicId);
      if (idx !== -1) {
        topics[idx].title = title;
        topics[idx].guide = guide;
        localStorage.setItem('topic_list', JSON.stringify(topics));
        return { success: true, message: '주제가 수정되었습니다.' };
      }
      return { success: false, message: '주제를 찾을 수 없습니다.' };
    }

    try {
      const { error } = await supabase
        .from('topics')
        .update({ title, guide })
        .eq('id', topicId);

      if (error) throw error;
      return { success: true, message: '주제가 성공적으로 수정되었습니다.' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async deleteTopic(topicId) {
    if (!this.isSupabaseConfigured()) {
      const topics = await this.getTopicList();
      const filtered = topics.filter(t => t.id !== topicId);
      localStorage.setItem('topic_list', JSON.stringify(filtered));
      return { success: true, message: '주제가 삭제되었습니다.' };
    }

    try {
      const { error } = await supabase
        .from('topics')
        .delete()
        .eq('id', topicId);

      if (error) throw error;
      return { success: true, message: '주제가 성공적으로 삭제되었습니다.' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async verifyParent(studentName, code) {
    if (!this.isSupabaseConfigured()) {
      const auth = JSON.parse(localStorage.getItem('auth_list')) || {};
      if (auth[studentName] && auth[studentName].toString() === code.toString()) {
        return { success: true };
      }
      return { success: false, message: '이름 또는 인증번호가 다릅니다.' };
    }

    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('name', studentName)
        .eq('parent_code', code)
        .maybeSingle();

      if (error) throw error;
      if (data) return { success: true };
      return { success: false, message: '일치하는 학생 인증 정보가 없습니다.' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getWorksForParent(studentName) {
    if (!this.isSupabaseConfigured()) {
      const db = JSON.parse(localStorage.getItem('student_works')) || {};
      const list = db[studentName] || [];
      return list.filter(w => w.status === '제출완료' || w.status === '과제완료');
    }

    try {
      const { data, error } = await supabase
        .from('works')
        .select('*')
        .eq('student_name', studentName)
        .in('status', ['제출완료', '과제완료'])
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async getStudentWorks(studentEmail) {
    if (!this.isSupabaseConfigured()) {
      const localName = studentEmail.split('@')[0];
      const db = JSON.parse(localStorage.getItem('student_works')) || {};
      return db[localName] || [];
    }

    try {
      const { data, error } = await supabase
        .from('works')
        .select('*')
        .eq('student_email', studentEmail)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async saveStudentWork(studentEmail, studentName, topicId, title, content, status) {
    if (!this.isSupabaseConfigured()) {
      const db = JSON.parse(localStorage.getItem('student_works')) || {};
      if (!db[studentName]) db[studentName] = [];
      const now = new Date().toLocaleString();

      const idx = db[studentName].findIndex(w => w.topicId === topicId);
      if (idx !== -1) {
        db[studentName][idx].title = title;
        db[studentName][idx].content = content;
        db[studentName][idx].status = status;
        db[studentName][idx].date = now;
      } else {
        db[studentName].push({
          topicId, title, content, status, date: now, feedback: '', star: 0
        });
      }
      localStorage.setItem('student_works', JSON.stringify(db));
      return { success: true, message: '로컬 임시저장되었습니다.' };
    }

    try {
      // Find existing work row
      const { data: existing, error: selectErr } = await supabase
        .from('works')
        .select('id, feedback, star, spelling_log')
        .eq('student_email', studentEmail)
        .eq('topic_id', topicId)
        .maybeSingle();

      if (selectErr) throw selectErr;

      const payload = {
        student_email: studentEmail,
        student_name: studentName,
        topic_id: topicId,
        title,
        content,
        status,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        const { error: updateErr } = await supabase
          .from('works')
          .update(payload)
          .eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('works')
          .insert([payload]);
        if (insertErr) throw insertErr;
      }

      return { success: true, message: status === '제출완료' ? '제출되었습니다!' : '저장되었습니다!' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async getTopWorksByTopic(topicId) {
    if (!this.isSupabaseConfigured()) {
      return [];
    }

    try {
      const { data, error } = await supabase
        .from('works')
        .select('student_name, title, content, star')
        .eq('topic_id', topicId)
        .eq('status', '과제완료')
        .order('star', { ascending: false })
        .limit(5);

      if (error) throw error;
      return data.map(w => ({
        name: w.student_name,
        title: w.title,
        content: w.content,
        star: w.star,
        firstLine: (w.content || '').substring(0, 60)
      }));
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async getSubmissionsByTopic(topicId) {
    if (!this.isSupabaseConfigured()) {
      return [];
    }

    try {
      // Fetch all registered students
      const students = await this.getStudentList();
      // Fetch all works for this topic
      const { data: works, error } = await supabase
        .from('works')
        .select('*')
        .eq('topic_id', topicId);

      if (error) throw error;

      return students.map(s => {
        const work = works.find(w => w.student_email === s.email);
        if (work) {
          return {
            name: s.name,
            email: s.email,
            status: work.status,
            title: work.title,
            content: work.content,
            feedback: work.feedback || '',
            date: work.updated_at ? new Date(work.updated_at).toLocaleDateString() : '',
            star: work.star || 0,
            id: work.id
          };
        }
        return {
          name: s.name,
          email: s.email,
          status: '미작성',
          title: '',
          content: '',
          feedback: '',
          date: '',
          star: 0,
          id: null
        };
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async teacherFeedback(studentEmail, topicId, feedback, newStatus, editedContent, star) {
    if (!this.isSupabaseConfigured()) {
      return { success: false, message: 'Supabase가 설정되지 않았습니다.' };
    }

    try {
      const payload = {
        status: newStatus,
        feedback,
        star,
        updated_at: new Date().toISOString()
      };
      if (editedContent) {
        payload.content = editedContent;
      }

      const { error } = await supabase
        .from('works')
        .update(payload)
        .eq('student_email', studentEmail)
        .eq('topic_id', topicId);

      if (error) throw error;
      return { success: true, message: '피드백이 성공적으로 등록되었습니다.' };
    } catch (e) {
      return { success: false, message: e.message };
    }
  },

  async saveSpellingLog(studentEmail, topicId, spellLog) {
    if (!this.isSupabaseConfigured()) return;
    try {
      await supabase
        .from('works')
        .update({ spelling_log: spellLog })
        .eq('student_email', studentEmail)
        .eq('topic_id', topicId);
    } catch (e) {
      console.error(e);
    }
  }
};

// =========================================================================
// 3. AUTHENTICATION CONTROLLER (Supabase Google Sign-In)
// =========================================================================
async function initAuthState() {
  if (!DB.isSupabaseConfigured()) {
    // Alert user that DB is running in local storage fallback mode
    showToast('Supabase 설정 미완료: 로컬 저장소 모드로 작동합니다.', 'error');
    return;
  }

  // Handle OAuth redirect check
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) console.error(error);

  if (session) {
    handleUserSession(session);
  }

  // Listen to auth changes
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      handleUserSession(session);
    } else {
      currentUser = null;
      currentUserEmail = null;
      currentRole = null;
      showPage('login');
    }
  });
}

async function handleUserSession(session) {
  const email = session.user.email;
  console.log('로그인 시도 이메일 (Google Email):', email);
  currentUserEmail = email;
  showLoading(true);

  const reg = await DB.checkStudentRegistration(email);
  showLoading(false);

  if (reg.valid) {
    if (reg.isTeacher) {
      currentUser = '선생님';
      currentRole = 'teacher';
      document.getElementById('header-user').textContent = '👩‍🏫 선생님';
      switchTeacherTab('overview');
      showPage('teacher');
      loadTopicsForTeacher();
    } else {
      currentUser = reg.name;
      currentRole = 'student';
      document.getElementById('header-user').textContent = `🙋 ${reg.name}`;
      document.getElementById('np-student-name').textContent = reg.name;
      showPage('student');

      // Query Student topics and works
      const topics = await DB.getTopicList();
      const works = await DB.getStudentWorks(email);
      window._cachedTopics = topics;
      window._cachedWorks = works;
      renderTopicsFromCache();
      renderWorksFromCache();
    }
  } else {
    // User signed in with Google but is not registered in the students list
    showToast('우리 반 목록에 등록되지 않은 이메일입니다. 로그아웃합니다.', 'error');
    setTimeout(() => {
      supabase.auth.signOut();
    }, 3000);
  }
}

async function loginStudentGoogle() {
  if (!DB.isSupabaseConfigured()) {
    // Local storage fallback login
    const name = document.getElementById('student-name-input').value.trim();
    if (!name) { showToast('이름을 입력해주세요!', 'error'); return; }

    const list = await DB.getStudentList();
    if (!list.includes(name)) {
      showToast('등록되지 않은 이름입니다.', 'error');
      return;
    }

    currentUser = name;
    currentUserEmail = `${name}@school.local`;
    currentRole = 'student';
    document.getElementById('header-user').textContent = `🙋 ${name}`;
    document.getElementById('np-student-name').textContent = name;

    showPage('student');

    const topics = await DB.getTopicList();
    const works = await DB.getStudentWorks(currentUserEmail);
    window._cachedTopics = topics;
    window._cachedWorks = works;
    renderTopicsFromCache();
    renderWorksFromCache();
    return;
  }

  showLoading(true);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin
    }
  });
  if (error) {
    showLoading(false);
    showToast('구글 로그인 실패: ' + error.message, 'error');
  }
}

async function logout() {
  showLoading(true);
  if (DB.isSupabaseConfigured()) {
    await supabase.auth.signOut();
  }
  showLoading(false);

  currentUser = null;
  currentUserEmail = null;
  currentRole = null;
  selectedTopicId = null;

  document.getElementById('student-name-input').value = '';
  document.getElementById('parent-name-input').value = '';
  document.getElementById('parent-code-input').value = '';
  document.getElementById('editor-title').value = '';
  document.getElementById('editor-content').innerHTML = '';

  showViewStudent('topic-list');
  showPage('login');
}

// =========================================================================
// 4. FRONTEND UI LOGIC & CONTROLS BINDING
// =========================================================================
function renderTopicsFromCache() {
  const topics = window._cachedTopics || [];
  const works = window._cachedWorks || [];
  const container = document.getElementById('student-topic-list');
  if (!container) return;

  if (topics.length === 0) {
    container.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 40px 0;">등록된 주제가 없습니다.</div>';
    return;
  }

  const statusMap = {};
  works.forEach(w => statusMap[w.topic_id] = w.status);

  let html = '';
  topics.forEach((t, i) => {
    const status = statusMap[t.id] || '미작성';
    let badgeClass = 'badge-none';
    if (status === '임시저장') badgeClass = 'badge-draft';
    if (status === '제출완료') badgeClass = 'badge-submitted';
    if (status === '과제완료') badgeClass = 'badge-done';
    if (status === '수정요청') badgeClass = 'badge-revise';

    html += `
      <div class="spotify-topic-card ${selectedTopicId === t.id ? 'selected' : ''}" onclick="selectTopic('${t.id}', '${escapeHtml(t.title)}', '${escapeHtml(t.guide || '')}')">
        <div class="topic-badge-container">
          <span class="topic-index">TOPIC ${String(i + 1).padStart(2, '0')}</span>
          <span class="badge ${badgeClass}">${status}</span>
        </div>
        <div class="topic-title">${escapeHtml(t.title)}</div>
        <div class="topic-guide">${escapeHtml(t.guide || '안내가 없습니다.')}</div>
        <div class="topic-footer">등록일: ${t.date}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

function renderWorksFromCache() {
  const works = window._cachedWorks || [];
  const container = document.getElementById('my-works-list');
  if (!container) return;

  if (works.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px 0;">아직 보관된 글이 없습니다.</div>';
    return;
  }

  const topics = window._cachedTopics || [];
  const topicMap = {};
  topics.forEach(t => topicMap[t.id] = t.title);

  let html = '';
  works.forEach((w, i) => {
    let badgeClass = 'badge-none';
    if (w.status === '임시저장') badgeClass = 'badge-draft';
    if (w.status === '제출완료') badgeClass = 'badge-submitted';
    if (w.status === '과제완료') badgeClass = 'badge-done';
    if (w.status === '수정요청') badgeClass = 'badge-revise';

    let stars = '';
    if (w.star > 0) {
      stars = `<span style="color: var(--color-warning); margin-left: 8px;">${'★'.repeat(w.star)}${'☆'.repeat(5 - w.star)}</span>`;
    }

    html += `
      <div class="work-row" onclick="openMyWork(${i})">
        <div class="work-info-part">
          <span class="work-title-h">${escapeHtml(w.title || '(제목 없음)')}</span>
          <span class="work-subtitle-meta">주제: ${escapeHtml(topicMap[w.topic_id] || w.topic_id)} | 작성일: ${new Date(w.updated_at).toLocaleDateString()} ${stars}</span>
        </div>
        <span class="badge ${badgeClass}">${w.status}</span>
      </div>
    `;
  });
  container.innerHTML = html;
}

function showViewStudent(view) {
  document.getElementById('view-topic-list').style.display = view === 'topic-list' ? 'block' : 'none';
  document.getElementById('view-editor').style.display = view === 'editor' ? 'block' : 'none';
}

async function selectTopic(id, title, guide) {
  selectedTopicId = id;
  selectedTopicTitle = title;
  selectedTopicGuide = guide;

  document.getElementById('selected-topic-title').textContent = title;
  document.getElementById('selected-topic-guide').textContent = guide || '자유롭게 서술해주세요.';

  // Update Bottom player bar
  document.getElementById('np-topic-title').textContent = title;
  document.getElementById('now-playing-panel').style.display = 'flex';

  // Clear editor state
  document.getElementById('editor-title').value = '';
  document.getElementById('editor-content').innerHTML = '';
  document.getElementById('editor-status-badge').innerHTML = '';
  document.getElementById('student-feedback-box').style.display = 'none';

  closeRefine();
  document.getElementById('spell-panel').classList.remove('open');

  showViewStudent('editor');
  updateCharCount();

  // Load existing essay draft
  showLoading(true);
  try {
    const works = window._cachedWorks || [];
    const draft = works.find(w => w.topic_id === id) || null;
    const topWorks = await DB.getTopWorksByTopic(id);

    showLoading(false);
    if (draft) {
      document.getElementById('editor-title').value = draft.title || '';
      setEditorContent(draft.content || '');
      updateCharCount();
      setEditorBadge(draft.status);
      if (draft.feedback) {
        document.getElementById('student-feedback-box').style.display = 'block';
        document.getElementById('student-feedback-text').textContent = draft.feedback;
      }
    } else {
      setEditorBadge('미작성');
    }
    renderTopWorks(topWorks);
  } catch (e) {
    showLoading(false);
    renderTopWorks([]);
  }
}

function renderTopWorks(tops) {
  const wrap = document.getElementById('top-works-wrap');
  const container = document.getElementById('top-works-list');
  if (!container) return;

  if (tops.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  let html = '';
  tops.forEach((w) => {
    html += `
      <div style="background-color: var(--bg-surface); padding: 16px; border-radius: 6px; margin-bottom: 8px; border: 1px solid var(--border-gray);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <span style="font-weight: 700; color: var(--spotify-green);">${escapeHtml(w.name)}의 우수글</span>
          <span style="color: var(--color-warning);">${'★'.repeat(w.star)}</span>
        </div>
        <div style="font-size: 14px; font-weight: 700; margin-bottom: 4px;">제목: ${escapeHtml(w.title)}</div>
        <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(w.content)}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

async function backToTopicList() {
  selectedTopicId = null;
  document.getElementById('now-playing-panel').style.display = 'none';
  showViewStudent('topic-list');

  // Reload topics & works
  showLoading(true);
  const topics = await DB.getTopicList();
  const works = await DB.getStudentWorks(currentUserEmail);
  showLoading(false);

  window._cachedTopics = topics;
  window._cachedWorks = works;
  renderTopicsFromCache();
  renderWorksFromCache();
}

function focusMyWorksList() {
  backToTopicList();
  setTimeout(() => {
    document.getElementById('my-works-container').scrollIntoView({ behavior: 'smooth' });
  }, 300);
}

function openMyWork(idx) {
  const w = window._cachedWorks[idx];
  if (!w) return;

  const topics = window._cachedTopics || [];
  const topicMap = {};
  topics.forEach(t => topicMap[t.id] = t.title);

  document.getElementById('my-modal-title').textContent = w.title || '(제목 없음)';
  document.getElementById('my-modal-badge').innerHTML = statusBadgeHTML(w.status);
  document.getElementById('my-modal-topic').textContent = `📌 ${topicMap[w.topic_id] || w.topic_id} | ${new Date(w.updated_at).toLocaleDateString()}`;

  const starEl = document.getElementById('my-modal-star');
  if (w.star > 0) {
    starEl.textContent = '★'.repeat(w.star);
  } else {
    starEl.textContent = '';
  }

  document.getElementById('my-modal-content').textContent = w.content || '';

  const fbBox = document.getElementById('my-modal-feedback');
  if (w.feedback) {
    fbBox.style.display = 'block';
    document.getElementById('my-modal-feedback-text').textContent = w.feedback;
  } else {
    fbBox.style.display = 'none';
  }

  const btnWrap = document.getElementById('my-modal-edit-btn-wrap');
  btnWrap.innerHTML = `<button class="btn-spotify" onclick="goEditFromModal('${w.topic_id}', '${escapeHtml(topicMap[w.topic_id])}')">✏️ 수정하러 가기</button>`;

  document.getElementById('modal-my-work').style.display = 'flex';
}

function goEditFromModal(topicId, topicTitle) {
  closeMyModal();
  selectTopic(topicId, topicTitle, '');
}

function closeMyModal() {
  document.getElementById('modal-my-work').style.display = 'none';
}

// Editor helpers
function getEditorText() {
  const el = document.getElementById('editor-content');
  if (!el) return '';

  let lines = [];
  el.childNodes.forEach(node => {
    if (node.nodeType === 3) {
      lines.push(node.textContent);
    } else if (node.nodeName === 'P' || node.nodeName === 'DIV') {
      let lineText = '';
      node.childNodes.forEach(child => {
        if (child.nodeType === 3) {
          lineText += child.textContent;
        } else if (child.nodeName === 'IMG') {
          lineText += '[사진]';
        } else if (child.nodeName === 'BR') {
          // line break
        } else {
          lineText += child.textContent;
        }
      });
      lines.push(lineText);
    } else if (node.nodeName === 'BR') {
      lines.push('');
    } else if (node.nodeName === 'IMG') {
      lines.push('[사진]');
    } else {
      lines.push(node.textContent);
    }
  });

  return lines.join('\n').trim();
}

function setEditorContent(text) {
  const el = document.getElementById('editor-content');
  if (!el) return;
  el.innerHTML = '';
  if (!text) return;

  const lines = text.split('\n');
  lines.forEach(line => {
    const p = document.createElement('p');
    if (line === '') {
      p.appendChild(document.createElement('br'));
    } else {
      p.textContent = line;
    }
    el.appendChild(p);
  });
}

function updateCharCount() {
  const len = getEditorText().length;
  document.getElementById('char-count').textContent = `${len.toLocaleString()}자`;
  document.getElementById('np-time-current').textContent = `${len}자`;

  const progressPercent = Math.min((len / 300) * 100, 100);
  document.getElementById('np-progress-fill').style.width = `${progressPercent}%`;
}

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  document.getElementById('auto-save-time').textContent = '입력 중...';
  document.getElementById('np-auto-save-label').textContent = '저장 중...';

  autoSaveTimer = setTimeout(async function () {
    const title = document.getElementById('editor-title').value.trim();
    const content = getEditorText();
    if (title && content && currentRole === 'student' && selectedTopicId) {
      await DB.saveStudentWork(currentUserEmail, currentUser, selectedTopicId, title, content, '임시저장');
      document.getElementById('auto-save-time').textContent = '자동 저장 완료';
      document.getElementById('np-auto-save-label').textContent = '자동저장 완료';
    }
  }, 3000);
}

function setEditorBadge(status) {
  const el = document.getElementById('editor-status-badge');
  el.innerHTML = statusBadgeHTML(status);
}

function statusBadgeHTML(status) {
  const map = {
    '임시저장': ['badge-draft', '💾 임시저장'],
    '제출완료': ['badge-submitted', '📤 제출완료'],
    '과제완료': ['badge-done', '✅ 완료'],
    '수정요청': ['badge-revise', '🔄 수정요청'],
    '미작성': ['badge-none', '⬜ 미작성']
  };
  const entry = map[status] || ['badge-none', status || '미작성'];
  return `<span class="badge ${entry[0]}">${entry[1]}</span>`;
}

function setAlign(align) {
  document.querySelectorAll('.toolbar-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  if (align === 'left') document.getElementById('align-left').classList.add('active');
  if (align === 'center') document.getElementById('align-center').classList.add('active');
  if (align === 'right') document.getElementById('align-right').classList.add('active');

  try {
    const cmd = align === 'left' ? 'justifyLeft' : align === 'center' ? 'justifyCenter' : 'justifyRight';
    document.execCommand(cmd, false, null);
  } catch (e) { }
}

// Student Action Buttons
async function saveDraft() {
  const title = document.getElementById('editor-title').value.trim();
  const content = getEditorText();
  if (!title) { showToast('제목을 입력해주세요!', 'error'); return; }
  if (!content) { showToast('내용을 입력해주세요!', 'error'); return; }

  showLoading(true);
  const res = await DB.saveStudentWork(currentUserEmail, currentUser, selectedTopicId, title, content, '임시저장');
  showLoading(false);

  if (res.success) {
    showToast('💾 임시저장 되었습니다.', 'success');
    setEditorBadge('임시저장');
  } else {
    showToast(res.message, 'error');
  }
}

async function submitWork() {
  const title = document.getElementById('editor-title').value.trim();
  const content = getEditorText();
  if (!title) { showToast('제목을 입력해주세요!', 'error'); return; }
  if (!content || content.length < 30) { showToast('글 내용을 30자 이상 작성해주세요!', 'error'); return; }

  if (!confirm('선생님께 글을 제출할까요?')) return;

  showLoading(true);
  const res = await DB.saveStudentWork(currentUserEmail, currentUser, selectedTopicId, title, content, '제출완료');
  showLoading(false);

  if (res.success) {
    showToast('📤 성공적으로 제출되었습니다.', 'success');
    setEditorBadge('제출완료');
  } else {
    showToast(res.message, 'error');
  }
}

async function handleAICallClientSide(methodName, args, runner) {
  const apiKey = localStorage.getItem('openai_api_key') || '';
  if (!apiKey) {
    runner._failure('OpenAI API Key가 설정되지 않았습니다. 교사 설정에서 API Key를 입력해주세요.');
    showToast('OpenAI API Key가 설정되지 않았습니다. 교사 설정에서 입력해주세요.', 'error');
    return;
  }

  try {
    let systemPrompt = '';
    let userPrompt = '';
    let responseFormatType = 'json_object';

    if (methodName === 'checkSpelling') {
      const text = args[0];
      systemPrompt = '한국어 맞춤법 검사 전문가입니다. 실제로 틀린 것만 찾아주세요. 규칙: 1)띄어쓰기만 다른 경우는 포함하지 마세요. 2)올바른 표현은 포함하지 마세요. 3)original과 corrected가 같으면 포함하지 마세요. 반드시 순수 JSON만 응답하세요. 형식: {"items":[{"original":"틀린표현","corrected":"올바른표현","help":"간단한설명"}]} 오류 없으면 {"items":[]}';
      userPrompt = text;
    } else if (methodName === 'refineText') {
      const [text, topicTitle, topicGuide] = args;
      systemPrompt = '초등학교 교사이며 글쓰기 지도 전문가입니다. 학생이 작성한 글을 분석하여 문맥을 매끄럽게 다듬고, 맞춤법을 수정하며, 더 좋은 문장 표현으로 다듬어 줍니다. 단, 학생의 원래 의도와 주제를 훼손하지 않아야 합니다. 반드시 다듬어진 최종 글 본문만 JSON 형식으로 응답하세요. 형식: {"refined":"다듬어진 최종 글 전체 내용"}';
      userPrompt = `주제: ${topicTitle}\n안내 및 조건: ${topicGuide}\n\n학생이 작성한 글:\n${text}`;
    } else {
      throw new Error(`지원하지 않는 AI 메서드입니다: ${methodName}`);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: methodName === 'checkSpelling' ? 0 : 0.7,
        max_tokens: 1500,
        response_format: { type: responseFormatType }
      })
    });

    if (response.status === 401) {
      runner._failure('API 키가 잘못되었습니다.');
      return;
    }
    if (response.status === 429) {
      runner._failure('API 사용량이 초과되었습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    if (!response.ok) {
      runner._failure(`API 오류 (코드: ${response.status})`);
      return;
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    const result = JSON.parse(content);

    if (methodName === 'checkSpelling') {
      const rawItems = result.items || [];
      const filtered = [];
      const seen = {};

      for (const item of rawItems) {
        if (!item.original || !item.corrected) continue;
        const orig = item.original.replace(/\s+/g, '');
        const corr = item.corrected.replace(/\s+/g, '');
        if (orig === corr) continue;
        if (item.help && (item.help.includes('오류가 없') || item.help.includes('맞춤법 오류가 없'))) continue;

        const key = `${item.original}>>>${item.corrected}`;
        if (!seen[key]) {
          seen[key] = true;
          filtered.push(item);
        }
      }
      runner._success({ items: filtered });
    } else {
      runner._success(result);
    }
  } catch (e) {
    console.error('AI 호출 오류:', e);
    runner._failure(`오류: ${e.message}`);
  }
}

// Spellcheck and OpenAI Text Refine calls
async function runSpellCheck() {
  const text = getEditorText().trim();
  if (!text) { showToast('글을 먼저 작성해주세요.', 'error'); return; }

  const panel = document.getElementById('spell-panel');
  const results = document.getElementById('spell-results');
  panel.classList.add('open');
  results.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 12px 0;">AI가 맞춤법 교정안을 찾는 중... (3~7초 소요)</div>';

  window._appliedSpells = [];

  // Run mock run call which proxies to OpenAI Client
  const runner = {
    _success: function (data) {
      if (!data || data.error) {
        results.innerHTML = `<div style="color: var(--color-error);">${(data && data.error) || '오류가 발생했습니다.'}</div>`;
        return;
      }
      if (!data.items || data.items.length === 0) {
        results.innerHTML = '<div style="color: var(--spotify-green); font-weight:700; text-align:center;">✓ 맞춤법 및 띄어쓰기 오류가 감지되지 않았습니다!</div>';
        return;
      }
      renderSpellResults(data.items);
    },
    _failure: function (err) {
      results.innerHTML = '<div style="color: var(--color-error);">맞춤법 검사 중 시스템 에러가 발생했습니다.</div>';
    }
  };

  handleAICallClientSide('checkSpelling', [text], runner);
}

function renderSpellResults(items) {
  const results = document.getElementById('spell-results');
  window._spellItems = items;

  let html = '';
  items.forEach((item, i) => {
    html += `
      <div class="spell-card" id="spell-item-${i}">
        <div class="spell-header">
          <span class="spell-bad">${escapeHtml(item.original)}</span>
          <span style="color: var(--text-muted);">→</span>
          <span class="spell-good">${escapeHtml(item.corrected)}</span>
        </div>
        ${item.help ? `<div class="spell-explain">${escapeHtml(item.help)}</div>` : ''}
        <div style="text-align: right;">
          <button class="btn-spotify-secondary" style="padding: 4px 12px; font-size: 11px;" onclick="window.applySpell(${i})">적용하기</button>
        </div>
      </div>
    `;
  });
  results.innerHTML = html;
}

window.applySpell = function (idx) {
  const item = window._spellItems[idx];
  if (!item) return;

  const escaped = item.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'g');
  const newText = getEditorText().replace(re, item.corrected);

  setEditorContent(newText);
  updateCharCount();

  if (item.original.trim() !== item.corrected.trim()) {
    window._appliedSpells.push(item.original);
  }

  const itemEl = document.getElementById('spell-item-' + idx);
  if (itemEl) {
    itemEl.style.opacity = '0.3';
    itemEl.querySelector('button').disabled = true;
    itemEl.querySelector('button').textContent = '적용됨';
  }

  showToast('수정이 본문에 적용되었습니다.', 'success');

  DB.saveSpellingLog(currentUserEmail, selectedTopicId, window._appliedSpells.join(', '));
};

async function runRefine() {
  const text = getEditorText().trim();
  if (!text) { showToast('글을 먼저 작성해주세요.', 'error'); return; }
  if (text.length < 15) { showToast('충분한 내용이 필요합니다. 조금 더 길게 써주세요!', 'error'); return; }

  const panel = document.getElementById('refine-panel');
  const content = document.getElementById('refine-content');
  panel.classList.add('open');
  content.innerHTML = '<div style="color: var(--text-muted); text-align: center;">AI 선생님이 문장을 아름답게 다듬고 있습니다...</div>';

  const runner = {
    _success: function (result) {
      if (!result || result.error) {
        content.innerHTML = `<div style="color: var(--color-error);">${(result && result.error) || '오류가 발생했습니다.'}</div>`;
        return;
      }
      content.textContent = result.refined;
      window._refinedText = result.refined;
    },
    _failure: function () {
      content.innerHTML = '<div style="color: var(--color-error);">글 다듬기 처리 중 장애가 발생했습니다.</div>';
    }
  };

  handleAICallClientSide('refineText', [text, selectedTopicTitle, selectedTopicGuide], runner);
}

window.applyRefined = function () {
  if (!window._refinedText) return;
  setEditorContent(window._refinedText);
  updateCharCount();
  closeRefine();
  showToast('다듬은 글이 본문에 적용되었습니다.', 'success');
};

function closeRefine() {
  document.getElementById('refine-panel').classList.remove('open');
  window._refinedText = null;
}

// ══ TEACHER VIEW FUNCTIONS ══
window.switchTeacherTab = function (tab) {
  document.querySelectorAll('.teacher-nav').forEach(el => el.classList.remove('active'));

  if (tab === 'overview') document.getElementById('tnav-overview').classList.add('active');
  if (tab === 'topics') document.getElementById('tnav-topics').classList.add('active');
  if (tab === 'settings') document.getElementById('tnav-settings').classList.add('active');

  document.getElementById('teacher-tab-overview').style.display = tab === 'overview' ? 'block' : 'none';
  document.getElementById('teacher-tab-topics').style.display = tab === 'topics' ? 'block' : 'none';
  document.getElementById('teacher-tab-settings').style.display = tab === 'settings' ? 'block' : 'none';

  if (tab === 'topics') loadTopicsForManage();
};

async function loadTopicsForTeacher() {
  const topics = await DB.getTopicList();
  const select = document.getElementById('teacher-topic-select-dropdown');
  if (!topics || topics.length === 0) {
    select.innerHTML = '<option value="">선택할 주제가 없습니다.</option>';
    return;
  }

  let html = '<option value="">-- 주제를 선택하세요 --</option>';
  topics.forEach(t => {
    html += `<option value="${t.id}">${escapeHtml(t.title)}</option>`;
  });
  select.innerHTML = html;

  if (currentTeacherTopicId) {
    select.value = currentTeacherTopicId;
  }
}

window.onTeacherSelectTopic = function (topicId) {
  if (!topicId) {
    document.getElementById('teacher-overview-content').style.display = 'none';
    return;
  }
  currentTeacherTopicId = topicId;
  const select = document.getElementById('teacher-topic-select-dropdown');
  const title = select.options[select.selectedIndex].text;

  document.getElementById('overview-title').textContent = `👥 ${title} - 진행 상태`;
  document.getElementById('teacher-overview-content').style.display = 'block';
  loadSubmissionsForTopic(topicId);
};

window.reloadSubmissions = function () {
  if (currentTeacherTopicId) loadSubmissionsForTopic(currentTeacherTopicId);
};

async function loadSubmissionsForTopic(topicId) {
  showLoading(true);
  const submissions = await DB.getSubmissionsByTopic(topicId);
  showLoading(false);

  window._submissions = submissions;
  renderStudentGrid(submissions);
  renderStats(submissions);
}

function renderStats(submissions) {
  const total = submissions.length;
  let submitted = 0, done = 0, revise = 0, none = 0;

  submissions.forEach(s => {
    if (s.status === '제출완료') submitted++;
    else if (s.status === '과제완료') done++;
    else if (s.status === '수정요청') revise++;
    else none++;
  });

  document.getElementById('teacher-stats').innerHTML = `
    <div class="stat-item">
      <div class="stat-value" style="color: var(--text-base);">${total}</div>
      <div class="stat-title">전체 학생</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color: var(--color-info);">${submitted}</div>
      <div class="stat-title">제출완료</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color: var(--spotify-green);">${done}</div>
      <div class="stat-title">과제완료</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color: var(--color-warning);">${revise}</div>
      <div class="stat-title">수정요청</div>
    </div>
    <div class="stat-item">
      <div class="stat-value" style="color: var(--text-muted);">${none}</div>
      <div class="stat-title">미제출</div>
    </div>
  `;
}

function renderStudentGrid(submissions) {
  const grid = document.getElementById('teacher-student-grid');
  if (submissions.length === 0) {
    grid.innerHTML = '<div style="text-align: center; color: var(--text-muted);">학생 목록이 비어있습니다.</div>';
    return;
  }

  const avatars = ['🐱', '🦊', '🐹', '🐶', '🦁', '🐼', '🐰', '🐸', '🐨', '🐙', '🦄', '🐬', '🐝', '🐳', '🦩', '🦚', '🦜'];
  function getAvatar(name) {
    let code = 0;
    for (let c = 0; c < name.length; c++) code += name.charCodeAt(c);
    return avatars[code % avatars.length];
  }

  let html = '';
  submissions.forEach((s, idx) => {
    let cls = '';
    if (s.status === '제출완료') cls = 'submitted';
    if (s.status === '과제완료') cls = 'done';
    if (s.status === '수정요청') cls = 'revise';

    let stars = s.star > 0 ? `<div style="color: var(--color-warning); font-size:12px; margin-top: 4px;">${'★'.repeat(s.star)}</div>` : '';

    html += `
      <div class="student-card ${cls}" onclick="window.openStudentWork(${idx})">
        <div class="student-avatar">${getAvatar(s.name)}</div>
        <div class="student-name-text">${escapeHtml(s.name)}</div>
        ${statusBadgeHTML(s.status)}
        ${stars}
      </div>
    `;
  });
  grid.innerHTML = html;
}

window.openStudentWork = function (idx) {
  const s = window._submissions[idx];
  if (!s) return;

  if (s.status === '미작성') {
    showToast(`${s.name} 학생은 아직 글을 시작하지 않았습니다.`, 'error');
    return;
  }

  selectedStudentData = { ...s };

  document.getElementById('modal-student-name').textContent = `${s.name} 학생의 제출 글`;
  document.getElementById('modal-student-badge').innerHTML = statusBadgeHTML(s.status);
  document.getElementById('modal-student-date').textContent = s.date ? `작성일: ${s.date}` : '';
  document.getElementById('modal-student-title').textContent = s.title || '(제목 없음)';
  document.getElementById('modal-student-content').textContent = s.content || '(본문 없음)';

  document.getElementById('modal-feedback').value = s.feedback || '';
  document.getElementById('modal-edit-content').value = s.content || '';

  currentStar = s.star || 0;
  renderStarInput(currentStar);

  document.getElementById('modal-student-work').style.display = 'flex';
};

function renderStarInput(val) {
  const stars = document.querySelectorAll('#modal-star-input .star-interactive');
  stars.forEach((star, i) => {
    if (i < val) {
      star.classList.add('active');
    } else {
      star.classList.remove('active');
    }
  });
}

window.closeModal = function () {
  document.getElementById('modal-student-work').style.display = 'none';
  selectedStudentData = null;
};

window.sendFeedback = async function (status) {
  if (!selectedStudentData) return;
  const feedback = document.getElementById('modal-feedback').value.trim();
  const editedContent = document.getElementById('modal-edit-content').value.trim();

  const content = editedContent !== selectedStudentData.content ? editedContent : '';

  showLoading(true);
  const res = await DB.teacherFeedback(selectedStudentData.email, currentTeacherTopicId, feedback, status, content, currentStar);
  showLoading(false);

  closeModal();
  if (res.success) {
    showToast('성공적으로 저장되었습니다.', 'success');
    reloadSubmissions();
  } else {
    showToast(res.message, 'error');
  }
};

// Teacher Topic Editors
async function loadTopicsForManage() {
  const topics = await DB.getTopicList();
  const container = document.getElementById('topic-manage-list');
  if (!topics || topics.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px 0;">추가된 주제가 없습니다.</div>';
    return;
  }

  let html = '';
  topics.forEach((t, i) => {
    html += `
      <div style="background-color: var(--bg-interactive); padding: 18px; border-radius: 6px; display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;">
        <div style="flex: 1;">
          <span style="font-size: 11px; color: var(--spotify-green); font-weight:700;">TOPIC ${i + 1} (${t.id})</span>
          <div style="font-size: 16px; font-weight: 700; margin: 4px 0;">${escapeHtml(t.title)}</div>
          <div style="font-size: 13px; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap;">${escapeHtml(t.guide || '')}</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-spotify-secondary" style="padding: 6px 14px; font-size: 12px;" onclick="window.editTopicPopup('${t.id}', '${escapeHtml(t.title)}', '${escapeHtml(t.guide || '')}')">수정</button>
          <button class="btn-spotify-danger" style="padding: 6px 14px; font-size: 12px;" onclick="window.deleteTopic('${t.id}')">삭제</button>
        </div>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.addTopic = async function () {
  const title = document.getElementById('new-topic-title').value.trim();
  const guide = document.getElementById('new-topic-guide').value.trim();
  if (!title) { showToast('주제 제목을 입력해주세요!', 'error'); return; }

  showLoading(true);
  const res = await DB.addTopic(title, guide);
  showLoading(false);

  if (res.success) {
    showToast('주제가 새로 등록되었습니다.', 'success');
    document.getElementById('new-topic-title').value = '';
    document.getElementById('new-topic-guide').value = '';
    loadTopicsForManage();
    loadTopicsForTeacher();
  } else {
    showToast(res.message, 'error');
  }
};

window.editTopicPopup = async function (id, title, guide) {
  const newTitle = prompt('새 주제 제목:', title);
  if (newTitle === null) return;
  const newGuide = prompt('새 주제 설명:', guide);
  if (newGuide === null) return;

  showLoading(true);
  const res = await DB.updateTopic(id, newTitle, newGuide);
  showLoading(false);

  if (res.success) {
    showToast('주제가 수정되었습니다.', 'success');
    loadTopicsForManage();
    loadTopicsForTeacher();
  } else {
    showToast(res.message, 'error');
  }
};

window.deleteTopic = async function (id) {
  if (!confirm('이 주제를 삭제할까요? (해당 주제의 학생 제출글은 유지되나 매핑이 해제됩니다)')) return;
  showLoading(true);
  const res = await DB.deleteTopic(id);
  showLoading(false);

  if (res.success) {
    showToast('주제가 삭제되었습니다.', 'success');
    loadTopicsForManage();
    loadTopicsForTeacher();
  } else {
    showToast(res.message, 'error');
  }
};

// ══ PARENT LOOKUP FUNCTIONS ══
window.loginParent = async function () {
  const name = document.getElementById('parent-name-input').value.trim();
  const code = document.getElementById('parent-code-input').value.trim();

  if (!name) { showToast('학생 이름을 입력해주세요!', 'error'); return; }
  if (!code) { showToast('인증번호를 입력해주세요!', 'error'); return; }

  showLoading(true);
  const res = await DB.verifyParent(name, code);
  showLoading(false);

  if (res.success) {
    currentUser = name;
    currentRole = 'parent';
    document.getElementById('parent-student-title').textContent = `${name} 학생의 글`;
    document.getElementById('header-user').textContent = `👪 ${name} 학부모`;
    showPage('parent');
    loadParentWorks(name);
  } else {
    showToast(res.message, 'error');
  }
};

async function loadParentWorks(studentName) {
  showLoading(true);
  const works = await DB.getWorksForParent(studentName);
  showLoading(false);

  const container = document.getElementById('parent-works-list');
  if (works.length === 0) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 40px 0;">아직 최종 완료되거나 제출된 글이 없습니다.</div>';
    return;
  }

  const topics = await DB.getTopicList();
  const topicMap = {};
  topics.forEach(t => topicMap[t.id] = t.title);

  let html = '';
  works.forEach(w => {
    let stars = w.star > 0 ? `<span style="color: var(--color-warning); margin-left: 10px;">${'★'.repeat(w.star)}</span>` : '';
    html += `
      <div class="card" style="background-color: var(--bg-interactive);">
        <div style="display:flex; justify-content:space-between; margin-bottom: 12px; border-bottom: 1px solid var(--border-gray); padding-bottom: 12px;">
          <div>
            <span style="font-size: 11px; color: var(--spotify-green); font-weight: 700;">주제: ${escapeHtml(topicMap[w.topic_id] || w.topic_id)}</span>
            <h3 style="font-size: 18px; font-weight: 700; margin-top: 4px;">제목: ${escapeHtml(w.title)}</h3>
          </div>
          <div>
            ${statusBadgeHTML(w.status)}
            ${stars}
          </div>
        </div>
        <div style="font-size: 15px; line-height: 1.8; white-space: pre-wrap; margin-bottom: 16px;">${escapeHtml(w.content)}</div>
        ${w.feedback ? `
          <div class="box-warning" style="margin-bottom:0;">
            <div class="box-warning-title">📝 선생님 피드백</div>
            <div style="font-size: 14px; line-height: 1.6; color: var(--text-base);">${escapeHtml(w.feedback)}</div>
          </div>
        ` : ''}
      </div>
    `;
  });
  container.innerHTML = html;
}

// ══ TEACHER DATABASE BACKUPS & CONFIG BINDINGS ══
function loadTeacherSettingsInputs() {
  DB.getStudentList().then(students => {
    const listText = students.map(s => `${s.email}, ${s.name}, ${s.parent_code}`).join('\n');
    document.getElementById('setting-student-list').value = listText;
  });

  const apiKey = localStorage.getItem('openai_api_key') || '';
  document.getElementById('setting-openai-key').value = apiKey;

  // Teacher email config
  const teacherEmail = localStorage.getItem('teacher_email') || 'gogh9@susaek.sen.es.kr';
  document.getElementById('setting-auth-list').value = teacherEmail;
}

window.saveSettings = function () {
  const key = document.getElementById('setting-openai-key').value.trim();
  localStorage.setItem('openai_api_key', key);
  showToast('OpenAI API Key 설정이 저장되었습니다.', 'success');
};

window.saveStudentsConfig = async function () {
  const lines = document.getElementById('setting-student-list').value.split('\n');
  const studentsArray = [];

  lines.forEach(line => {
    const parts = line.split(',');
    if (parts.length >= 3) {
      const email = parts[0].trim();
      const name = parts[1].trim();
      const parent_code = parts[2].trim();
      if (email && name && parent_code) {
        studentsArray.push({ email, name, parent_code });
      }
    }
  });

  if (studentsArray.length === 0) {
    showToast('올바른 형식(이메일, 이름, 부모인증코드)으로 작성해주세요.', 'error');
    return;
  }

  showLoading(true);
  const res = await DB.saveStudentList(studentsArray);
  showLoading(false);
  showToast(res.message, res.success ? 'success' : 'error');
};

window.saveAuthConfig = function () {
  const email = document.getElementById('setting-auth-list').value.trim();
  localStorage.setItem('teacher_email', email);
  showToast('선생님 인증용 이메일이 설정되었습니다.', 'success');
};

// Backup downloads
window.exportDataJSON = async function () {
  const topics = await DB.getTopicList();
  const students = await DB.getStudentList();

  const backup = {
    students_list: students,
    topic_list: topics
  };

  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backup, null, 2));
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute("href", dataStr);
  downloadAnchor.setAttribute("download", `우리반_글쓰기_백업_${new Date().toISOString().substring(0, 10)}.json`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
};

window.exportDataCSV = async function () {
  if (!DB.isSupabaseConfigured()) {
    showToast('Supabase가 연결되어 있지 않습니다.', 'error');
    return;
  }

  try {
    const { data: works, error } = await supabase.from('works').select('*');
    if (error) throw error;

    let csvContent = "\ufeff학생이름,주제ID,글제목,제출상태,글내용,피드백,별점,작성일시\n";
    works.forEach(w => {
      const cleanContent = (w.content || '').replace(/"/g, '""');
      const cleanFeedback = (w.feedback || '').replace(/"/g, '""');
      csvContent += `"${w.student_name}","${w.topic_id}","${w.title || ''}","${w.status}","${cleanContent}","${cleanFeedback}",${w.star || 0},"${w.updated_at}"\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", url);
    downloadAnchor.setAttribute("download", `우리반_글쓰기_종합_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  } catch (e) {
    showToast('CSV 추출 실패: ' + e.message, 'error');
  }
};

window.importDataJSON = async function (input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const data = JSON.parse(e.target.result);
      showLoading(true);
      if (data.students_list) {
        await DB.saveStudentList(data.students_list);
      }
      if (data.topic_list) {
        for (const t of data.topic_list) {
          await DB.addTopic(t.title, t.guide);
        }
      }
      showLoading(false);
      showToast('✅ 데이터 복구가 완료되었습니다.', 'success');
      loadTeacherSettingsInputs();
      loadTopicsForTeacher();
    } catch (err) {
      showLoading(false);
      showToast('올바르지 않은 JSON 파일입니다.', 'error');
    }
  };
  reader.readAsText(file);
  input.value = '';
};

// Bind DOM event listeners and setup OAuth state
document.addEventListener('DOMContentLoaded', () => {
  // Bind simple buttons
  document.getElementById('login-btn').addEventListener('click', loginStudentGoogle);
  document.getElementById('logout-btn').addEventListener('click', logout);
  document.getElementById('save-draft-btn').addEventListener('click', saveDraft);
  document.getElementById('submit-work-btn').addEventListener('click', submitWork);
  document.getElementById('refresh-topics-btn')?.addEventListener('click', backToTopicList);
  document.getElementById('refresh-works-btn')?.addEventListener('click', () => {
    DB.getStudentWorks(currentUserEmail).then(works => {
      window._cachedWorks = works;
      renderWorksFromCache();
    });
  });

  // Editor alignments
  document.getElementById('align-left').addEventListener('click', () => setAlign('left'));
  document.getElementById('align-center').addEventListener('click', () => setAlign('center'));
  document.getElementById('align-right').addEventListener('click', () => setAlign('right'));

  // Image handler
  const photoBtn = document.getElementById('photo-btn');
  const photoInput = document.getElementById('photo-file-input');
  photoBtn.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', function () {
    const files = this.files;
    if (!files || files.length === 0) return;
    const editor = document.getElementById('editor-content');
    editor.focus();

    for (let i = 0; i < files.length; i++) {
      const reader = new FileReader();
      reader.onload = function (e) {
        const img = document.createElement('img');
        img.src = e.target.result;
        img.className = 'editor-image';

        const p = document.createElement('p');
        p.appendChild(img);

        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
          const range = sel.getRangeAt(0);
          range.insertNode(p);
          range.collapse(false);
        } else {
          editor.appendChild(p);
        }
        updateCharCount();
      };
      reader.readAsDataURL(files[i]);
    }
    this.value = '';
  });

  // Modal stars click bindings
  const stars = document.querySelectorAll('#modal-star-input .star-interactive');
  stars.forEach(star => {
    star.addEventListener('click', () => {
      currentStar = parseInt(star.getAttribute('data-val'));
      renderStarInput(currentStar);
    });
  });

  // Input listeners
  const editor = document.getElementById('editor-content');
  if (editor) {
    editor.addEventListener('input', () => {
      updateCharCount();
      scheduleAutoSave();
    });
  }

  document.getElementById('editor-title').addEventListener('input', scheduleAutoSave);

  // Initialize Auth state
  initAuthState();
  loadTeacherSettingsInputs();
});

// Global UI & Navigation Helpers
function showPage(pageId) {
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => p.classList.remove('active'));
  
  const targetId = pageId.startsWith('page-') ? pageId : `page-${pageId}`;
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.add('active');
  } else {
    console.error(`Page element not found: ${targetId}`);
  }
  
  const header = document.getElementById('app-header');
  if (header) {
    if (pageId === 'login' || pageId === 'parent-login' || pageId === 'page-login' || pageId === 'page-parent-login') {
      header.style.display = 'none';
    } else {
      header.style.display = 'flex';
    }
  }
}

function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    overlay.style.display = show ? 'flex' : 'none';
  }
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  
  toast.textContent = message;
  toast.className = `toast-msg show ${type}`;
  
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.className = 'toast-msg';
  }, 3000);
}

function goToParentLogin() {
  showPage('parent-login');
}

function goToTeacherLogin() {
  showToast('교사 계정으로 로그인합니다. 구글 계정을 선택해 주세요.', 'info');
  loginStudentGoogle();
}

function goToMainLogin() {
  showPage('login');
}

function backToMain() {
  if (currentUser) {
    if (currentRole === 'teacher') {
      showPage('teacher');
    } else if (currentRole === 'student') {
      showPage('student');
      backToTopicList();
    } else {
      showPage('login');
    }
  } else {
    showPage('login');
  }
}

// Navigation shortcuts
window.backToTopicList = backToTopicList;
window.focusMyWorksList = focusMyWorksList;
window.goToParentLogin = goToParentLogin;
window.goToTeacherLogin = goToTeacherLogin;
window.goToMainLogin = goToMainLogin;
window.backToMain = backToMain;
window.closeMyModal = closeMyModal;
window.showPage = showPage;
window.showLoading = showLoading;
window.showToast = showToast;
window.logout = logout;
window.runSpellCheck = runSpellCheck;
window.runRefine = runRefine;
window.closeRefine = closeRefine;
window.selectTopic = selectTopic;
window.openMyWork = openMyWork;
window.goEditFromModal = goEditFromModal;

// Global Helpers
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
