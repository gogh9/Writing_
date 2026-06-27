// ==========================================
// 글쓰기 웹 앱 - Google Apps Script 백엔드
// 교사 전용 URL: 웹앱URL?mode=teacher
//
// 시트 구조:
//   [종합] 시트: A열=학생이름 (A1헤더, A2~)
//   [주제] 시트: A=주제ID, B=주제제목, C=주제안내, D=등록일
//   [학생이름] 시트: A=작성일시, B=제목, C=주제ID, D=내용, E=상태, F=피드백, G=교사수정, H=별점
// ==========================================

// 전역 ss 캐시 (GAS 실행 단위 내 재사용)
var _ss = null;
function getSS() {
  if (!_ss) _ss = SpreadsheetApp.getActiveSpreadsheet();
  return _ss;
}

function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode) ? e.parameter.mode : "student";
  var html = HtmlService.createHtmlOutputFromFile("index");
  var title = mode === "teacher" ? "📋 글쓰기 관리 - 선생님"
            : mode === "parent"  ? "📖 우리 아이 글 보기"
            : "✏️ 우리 반 글쓰기";
  html.setTitle(title);
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  var content = html.getContent();
  content = content.replace("__APP_MODE__", mode);
  html.setContent(content);
  return html;
}


// ==========================================
// 학부모: 인증 번호 확인 ([인증] 시트 A=이름, B=인증번호)
// ==========================================
function verifyParent(studentName, code) {
  try {
    var ss = getSS();
    var authSheet = ss.getSheetByName("인증");
    if (!authSheet) return { success: false, message: "인증 시트가 없습니다." };
    var lastRow = authSheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "인증 정보가 없습니다." };
    var data = authSheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < data.length; i++) {
      var name = data[i][0].toString().trim();
      var auth = data[i][1].toString().trim();
      if (name === studentName && auth === code.toString().trim()) {
        return { success: true, message: "인증 성공" };
      }
    }
    return { success: false, message: "이름 또는 인증번호가 올바르지 않습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 학부모: 학생 글 목록 조회 (제출완료/과제완료만)
// ==========================================
function getWorksForParent(studentName) {
  try {
    var ss = getSS();
    var studentSheet = ss.getSheetByName(studentName);
    if (!studentSheet) return [];
    var lastRow = studentSheet.getLastRow();
    if (lastRow < 2) return [];

    var topicList = getTopicList();
    var topicMap = {};
    for (var t = 0; t < topicList.length; t++) topicMap[topicList[t].id] = topicList[t].title;

    var data = studentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var works = [];
    for (var i = data.length - 1; i >= 0; i--) {
      var row = data[i];
      if (row[0] === "") continue;
      var status = row[4] ? row[4].toString() : "";
      // 제출완료 또는 과제완료만 노출
      if (status !== "제출완료" && status !== "과제완료") continue;
      var topicId = row[2] ? row[2].toString() : "";
      works.push({
        date:       row[0] ? row[0].toString() : "",
        title:      row[1] ? row[1].toString() : "",
        topicId:    topicId,
        topicTitle: topicMap[topicId] || topicId,
        content:    row[3] ? row[3].toString() : "",
        status:     status,
        feedback:   row[5] ? row[5].toString() : "",
        star:       row[7] ? Number(row[7]) : 0
      });
    }
    return works;
  } catch (e) { return []; }
}

// ==========================================
// 학생 목록 ([종합] 시트 A열, B열 호환)
// ==========================================
function getStudentList() {
  var configSheet = getOrCreateSheet("종합");
  var lastRow = configSheet.getLastRow();
  if (lastRow < 2) return [];

  // 한 번에 읽기
  var aData = configSheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var students = [];
  var hasA = false;

  for (var i = 0; i < aData.length; i++) {
    var a = aData[i][0].toString().trim();
    if (a !== "" && a !== "설정 항목" && a !== "학생 이름") { hasA = true; break; }
  }

  for (var j = 0; j < aData.length; j++) {
    var name = hasA ? aData[j][0].toString().trim() : aData[j][1].toString().trim();
    if (name !== "" && name !== "설정 항목" && name !== "학생 이름") students.push(name);
  }
  return students;
}

function saveStudentList(students) {
  try {
    var configSheet = getOrCreateSheet("종합");
    configSheet.getRange("A2:A100").clearContent();
    // 한 번에 쓰기
    var vals = students.map(function(n) { return [n]; });
    if (vals.length > 0) configSheet.getRange(2, 1, vals.length, 1).setValues(vals);
    return { success: true, message: "학생 목록이 저장되었습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 주제 목록 ([주제] 시트 우선, 구버전 G~J열 호환)
// ==========================================
function getTopicList() {
  var topics = [];

  var topicSheet = getOrCreateSheet("주제");
  var lastRow = topicSheet.getLastRow();
  if (lastRow >= 2) {
    // 한 번에 읽기
    var data = topicSheet.getRange(2, 1, lastRow - 1, 4).getValues();
    for (var i = 0; i < data.length; i++) {
      var id    = data[i][0] ? data[i][0].toString().trim() : "";
      var title = data[i][1] ? data[i][1].toString().trim() : "";
      var guide = data[i][2] ? data[i][2].toString().trim() : "";
      var dateVal = data[i][3];
      var dateStr = "";
      if (dateVal instanceof Date && !isNaN(dateVal.getTime())) {
        dateStr = Utilities.formatDate(dateVal, "Asia/Seoul", "yyyy. M. d.");
      } else if (dateVal) {
        dateStr = dateVal.toString().trim();
      }
      if (id !== "" && title !== "") topics.push({ id: id, title: title, guide: guide, date: dateStr });
    }
  }

  // 주제 시트 비어있으면 구버전 종합 시트 G~J열
  if (topics.length === 0) {
    var configSheet = getOrCreateSheet("종합");
    var configLastRow = configSheet.getLastRow();
    if (configLastRow >= 2) {
      var gData = configSheet.getRange(2, 7, configLastRow - 1, 4).getValues();
      for (var j = 0; j < gData.length; j++) {
        var gId    = gData[j][0] ? gData[j][0].toString().trim() : "";
        var gTitle = gData[j][1] ? gData[j][1].toString().trim() : "";
        var gGuide = gData[j][2] ? gData[j][2].toString().trim() : "";
        var gDateVal = gData[j][3];
        var gDateStr = "";
        if (gDateVal instanceof Date && !isNaN(gDateVal.getTime())) {
          gDateStr = Utilities.formatDate(gDateVal, "Asia/Seoul", "yyyy. M. d.");
        } else if (gDateVal) {
          gDateStr = gDateVal.toString().trim();
        }
        if (gId !== "" && gTitle !== "") topics.push({ id: gId, title: gTitle, guide: gGuide, date: gDateStr });
      }
    }
  }
  return topics;
}

function addTopic(title, guide) {
  try {
    var topicSheet = getOrCreateSheet("주제");
    var now = new Date();
    var dateStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy. M. d.");
    var lastRow = topicSheet.getLastRow();
    var nextRow = lastRow < 1 ? 2 : lastRow + 1;
    var topicCount = nextRow - 1;
    var id = "T" + (topicCount < 10 ? "00" + topicCount : topicCount < 100 ? "0" + topicCount : "" + topicCount);
    // 한 번에 쓰기
    topicSheet.getRange(nextRow, 1, 1, 4).setValues([[id, title, guide, dateStr]]);
    return { success: true, message: "주제가 추가되었습니다.", id: id };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

function updateTopic(topicId, title, guide) {
  try {
    var topicSheet = getOrCreateSheet("주제");
    var lastRow = topicSheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "주제 없음" };
    var data = topicSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0].toString() === topicId) {
        topicSheet.getRange(i + 2, 2, 1, 2).setValues([[title, guide]]);
        return { success: true, message: "주제가 수정되었습니다." };
      }
    }
    return { success: false, message: "주제를 찾을 수 없습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

function deleteTopic(topicId) {
  try {
    var topicSheet = getOrCreateSheet("주제");
    var lastRow = topicSheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "주제 없음" };
    var data = topicSheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0].toString() === topicId) {
        topicSheet.getRange(i + 2, 1, 1, 4).clearContent();
        return { success: true, message: "주제가 삭제되었습니다." };
      }
    }
    return { success: false, message: "주제를 찾을 수 없습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 학생 글 저장 (루프 안 getRange 제거 → 한 번에 읽기)
// ==========================================
function saveStudentWork(studentName, topicId, title, content, status) {
  try {
    var studentSheet = getOrCreateStudentSheet(studentName);
    var now = new Date();
    var dateStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    var lastRow = studentSheet.getLastRow();
    var targetRow = null;

    if (lastRow >= 2) {
      // 같은 주제의 기존 행 찾기 (상태 무관 - 중복 저장 방지)
      var data = studentSheet.getRange(2, 1, lastRow - 1, 5).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        var rowTopicId = data[i][2] ? data[i][2].toString() : "";
        if (rowTopicId === topicId) {
          targetRow = i + 2; break;
        }
      }
    }

    if (targetRow) {
      // 한 번에 쓰기
      studentSheet.getRange(targetRow, 1, 1, 5).setValues([[dateStr, title, topicId, content, status]]);
    } else {
      var newRow = lastRow + 1;
      studentSheet.getRange(newRow, 1, 1, 8).setValues([[dateStr, title, topicId, content, status, "", "", ""]]);
      studentSheet.setRowHeight(newRow, 60);
      // 정렬 한 번에 (A-C, E-I열 가운데)
      studentSheet.getRange(newRow, 1, 1, 3).setHorizontalAlignment("center").setVerticalAlignment("middle");
      studentSheet.getRange(newRow, 5, 1, 5).setHorizontalAlignment("center").setVerticalAlignment("middle");
      studentSheet.getRange(newRow, 4, 1, 1).setHorizontalAlignment("left").setVerticalAlignment("top").setWrap(true);
    }

    // 먼저 응답 반환 (빠른 응답)
    var msg = status === "제출완료" ? "제출되었습니다!" : "저장되었습니다!";

    // 제출 시 캐시 무효화 (가벼움)
    if (status === "제출완료") {
      try { CacheService.getScriptCache().remove('students_list'); } catch(ce) {}
      // 종합 시트 업데이트는 별도로 (응답 후 처리)
      updateSummarySheetRow(studentName);
    }
    return { success: true, message: msg };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 학생 글 목록 (한 번에 읽기)
// ==========================================
function getStudentWorks(studentName) {
  try {
    var ss = getSS();
    var studentSheet = ss.getSheetByName(studentName);
    if (!studentSheet) return [];
    var lastRow = studentSheet.getLastRow();
    if (lastRow < 2) return [];

    var topicList = getTopicList();
    var topicMap = {};
    for (var t = 0; t < topicList.length; t++) topicMap[topicList[t].id] = topicList[t].title;

    var data = studentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    var works = [];
    for (var i = data.length - 1; i >= 0; i--) {
      var row = data[i];
      if (row[0] === "") continue;
      var topicId = row[2] ? row[2].toString() : "";
      works.push({
        date:        row[0] ? row[0].toString() : "",
        title:       row[1] ? row[1].toString() : "",
        topicId:     topicId,
        topicTitle:  topicMap[topicId] || topicId,
        content:     row[3] ? row[3].toString() : "",
        status:      row[4] ? row[4].toString() : "",
        feedback:    row[5] ? row[5].toString() : "",
        teacherEdit: row[6] ? row[6].toString() : "",
        star:        row[7] ? Number(row[7]) : 0,
        rowIndex:    i + 2
      });
    }
    return works;
  } catch (e) { return []; }
}

// ==========================================
// 특정 주제 드래프트 (한 번에 읽기)
// ==========================================
function getDraftByTopic(studentName, topicId) {
  try {
    var ss = getSS();
    var studentSheet = ss.getSheetByName(studentName);
    if (!studentSheet) return null;
    var lastRow = studentSheet.getLastRow();
    if (lastRow < 2) return null;

    var data = studentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      var row = data[i];
      if ((row[2] ? row[2].toString() : "") === topicId) {
        return {
          date:     row[0] ? row[0].toString() : "",
          title:    row[1] ? row[1].toString() : "",
          topicId:  topicId,
          content:  row[3] ? row[3].toString() : "",
          status:   row[4] ? row[4].toString() : "",
          feedback: row[5] ? row[5].toString() : "",
          star:     row[7] ? Number(row[7]) : 0,
          rowIndex: i + 2
        };
      }
    }
    return null;
  } catch (e) { return null; }
}

// ==========================================
// 교사: 특정 주제 전체 학생 현황
// 스프레드시트를 한 번만 가져와서 재사용
// ==========================================
function getSubmissionsByTopic(topicId) {
  try {
    var ss = getSS();
    var students = getStudentList();
    var result = [];
    // 모든 시트 목록 한 번에 가져오기
    var allSheets = ss.getSheets();
    var sheetMap = {};
    for (var k = 0; k < allSheets.length; k++) sheetMap[allSheets[k].getName()] = allSheets[k];

    for (var s = 0; s < students.length; s++) {
      var name = students[s];
      var studentSheet = sheetMap[name];
      if (!studentSheet || studentSheet.getLastRow() < 2) {
        result.push({ name: name, status: "미작성", title: "", content: "", feedback: "", date: "", star: 0, rowIndex: -1 });
        continue;
      }
      var lastRow = studentSheet.getLastRow();
      var data = studentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
      var found = null;
      for (var i = data.length - 1; i >= 0; i--) {
        if ((data[i][2] ? data[i][2].toString() : "") === topicId) {
          found = { row: data[i], rowIndex: i + 2 }; break;
        }
      }
      if (!found) {
        result.push({ name: name, status: "미작성", title: "", content: "", feedback: "", date: "", star: 0, rowIndex: -1 });
      } else {
        result.push({
          name:     name,
          status:   found.row[4] ? found.row[4].toString() : "임시저장",
          title:    found.row[1] ? found.row[1].toString() : "",
          content:  found.row[3] ? found.row[3].toString() : "",
          feedback: found.row[5] ? found.row[5].toString() : "",
          date:     found.row[0] ? found.row[0].toString() : "",
          star:     found.row[7] ? Number(found.row[7]) : 0,
          rowIndex: found.rowIndex
        });
      }
    }
    return result;
  } catch (e) { return []; }
}

// ==========================================
// 교사: 피드백 + 별점 (한 번에 쓰기)
// ==========================================
function teacherFeedback(studentName, rowIndex, feedback, newStatus, editedContent, star) {
  try {
    var ss = getSS();
    var studentSheet = ss.getSheetByName(studentName);
    if (!studentSheet) return { success: false, message: "시트 없음" };
    var now = new Date();
    var dateStr = Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");

    // 기존 행 읽기
    var rowData = studentSheet.getRange(rowIndex, 1, 1, 8).getValues()[0];
    rowData[4] = newStatus;
    rowData[5] = feedback;
    if (star >= 1 && star <= 5) rowData[7] = star;
    if (editedContent && editedContent.trim() !== "") {
      rowData[3] = editedContent;
      rowData[6] = "교사 수정 (" + dateStr + ")";
    }
    // 한 번에 쓰기
    studentSheet.getRange(rowIndex, 1, 1, 8).setValues([rowData]);

    // 종합 시트 해당 학생 행만 업데이트
    updateSummarySheetRow(studentName);

    // 과제완료 시 topWorks 캐시 무효화 (친구 글 목록 갱신)
    if (newStatus === '과제완료') {
      try {
        var topicId = studentSheet.getRange(rowIndex, 3).getValue().toString();
        CacheService.getScriptCache().remove('topworks_' + topicId);
      } catch(ce) {}
    }

    return { success: true, message: "저장되었습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 학생: 친구 우수 글 TOP5
// ==========================================
function getTopWorksByTopic(topicId) {
  try {
    var ss = getSS();
    var students = getStudentList();
    var allSheets = ss.getSheets();
    var sheetMap = {};
    for (var k = 0; k < allSheets.length; k++) sheetMap[allSheets[k].getName()] = allSheets[k];
    var works = [];

    for (var s = 0; s < students.length; s++) {
      var name = students[s];
      var studentSheet = sheetMap[name];
      if (!studentSheet || studentSheet.getLastRow() < 2) continue;
      var lastRow = studentSheet.getLastRow();
      var data = studentSheet.getRange(2, 1, lastRow - 1, 8).getValues();
      for (var i = data.length - 1; i >= 0; i--) {
        if ((data[i][2] ? data[i][2].toString() : "") === topicId &&
            (data[i][4] ? data[i][4].toString() : "") === "과제완료") {
          var content = data[i][3] ? data[i][3].toString() : "";
          var star = data[i][7] ? Number(data[i][7]) : 0;
          var firstLine = (content.split('\n')[0] || '').trim();
          if (firstLine.length > 60) firstLine = firstLine.substring(0, 60) + "…";
          works.push({ name: name, title: data[i][1] ? data[i][1].toString() : "",
            content: content, firstLine: firstLine, star: star, len: content.length });
          break;
        }
      }
    }
    works.sort(function(a, b) { return b.star !== a.star ? b.star - a.star : b.len - a.len; });
    return works.slice(0, 5);
  } catch (e) { return []; }
}

// ==========================================
// 종합 시트: 특정 학생 행만 업데이트 (빠름)
// ==========================================
function updateSummarySheetRow(studentName) {
  try {
    var ss = getSS();
    var summarySheet = ss.getSheetByName("종합");
    if (!summarySheet) return;
    var topics = getTopicList();
    if (topics.length === 0) return;

    // 종합 시트에서 학생 행 위치 찾기
    var lastRow = summarySheet.getLastRow();
    if (lastRow < 2) return;
    var nameCol = summarySheet.getRange(2, 1, lastRow - 1, 1).getValues();
    var studentRow = -1;
    for (var r = 0; r < nameCol.length; r++) {
      if (nameCol[r][0].toString() === studentName) { studentRow = r + 2; break; }
    }
    if (studentRow === -1) return;

    // 학생 시트 한 번에 읽기
    var studentSheet = ss.getSheetByName(studentName);
    var statusMap = {};
    if (studentSheet && studentSheet.getLastRow() >= 2) {
      var sLastRow = studentSheet.getLastRow();
      var sData = studentSheet.getRange(2, 1, sLastRow - 1, 5).getValues();
      for (var i = sData.length - 1; i >= 0; i--) {
        var tid = sData[i][2] ? sData[i][2].toString() : "";
        if (tid && !statusMap[tid]) statusMap[tid] = sData[i][4] ? sData[i][4].toString() : "";
      }
    }

    // 해당 학생 행만 한 번에 쓰기
    var row = [studentName];
    for (var t = 0; t < topics.length; t++) {
      var status = statusMap[topics[t].id] || "";
      if (status === "과제완료")       row.push("✅");
      else if (status === "제출완료")  row.push("📤");
      else if (status === "수정요청")  row.push("🔄");
      else if (status === "임시저장")  row.push("💾");
      else row.push("");
    }
    summarySheet.getRange(studentRow, 1, 1, row.length).setValues([row]);
  } catch (e) { /* 종합 시트 업데이트 실패는 무시 */ }
}

// ==========================================
// 종합 시트 전체 재구성 (수동 실행용)
// ==========================================
function updateSummarySheet() {
  try {
    var ss = getSS();
    var summarySheet = ss.getSheetByName("종합");
    if (!summarySheet) summarySheet = ss.insertSheet("종합");

    var students = getStudentList();
    var topics   = getTopicList();
    if (students.length === 0 || topics.length === 0) return;

    // 헤더
    var headers = ["학생 이름"];
    for (var t = 0; t < topics.length; t++) headers.push(topics[t].title);
    summarySheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    summarySheet.getRange(1, 1, 1, headers.length).setBackground("#34495E").setFontColor("white").setFontWeight("bold");

    // 모든 시트 한 번에 가져오기
    var allSheets = ss.getSheets();
    var sheetMap = {};
    for (var k = 0; k < allSheets.length; k++) sheetMap[allSheets[k].getName()] = allSheets[k];

    // 전체 데이터 배열로 한 번에 쓰기
    var allRows = [];
    for (var s = 0; s < students.length; s++) {
      var name = students[s];
      var statusMap = {};
      var sheet = sheetMap[name];
      if (sheet && sheet.getLastRow() >= 2) {
        var sData = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
        for (var i = sData.length - 1; i >= 0; i--) {
          var tid = sData[i][2] ? sData[i][2].toString() : "";
          if (tid && !statusMap[tid]) statusMap[tid] = sData[i][4] ? sData[i][4].toString() : "";
        }
      }
      var row = [name];
      for (var ti = 0; ti < topics.length; ti++) {
        var st = statusMap[topics[ti].id] || "";
        if (st === "과제완료")      row.push("✅");
        else if (st === "제출완료") row.push("📤");
        else if (st === "수정요청") row.push("🔄");
        else if (st === "임시저장") row.push("💾");
        else row.push("");
      }
      allRows.push(row);
    }
    // 한 번에 전체 쓰기
    if (allRows.length > 0) summarySheet.getRange(2, 1, allRows.length, allRows[0].length).setValues(allRows);

    summarySheet.setColumnWidth(1, 100);
    for (var c = 2; c <= headers.length; c++) summarySheet.setColumnWidth(c, 120);
    summarySheet.setFrozenRows(1);
    summarySheet.setFrozenColumns(1);
    return { success: true, message: "종합 시트가 업데이트되었습니다." };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 유틸리티
// ==========================================
function getOrCreateSheet(sheetName) {
  var ss = getSS();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (sheetName === "종합") initConfigSheet(sheet);
    if (sheetName === "주제")  initTopicSheet(sheet);
  }
  return sheet;
}

function getOrCreateStudentSheet(studentName) {
  var ss = getSS();
  var sheet = ss.getSheetByName(studentName);
  if (!sheet) {
    sheet = ss.insertSheet(studentName);
    var headers = [["작성일시", "제목", "주제ID", "내용", "상태", "교사 피드백", "교사 수정", "별점", "맞춤법 수정"]];
    sheet.getRange(1, 1, 1, 8).setValues(headers);
    sheet.getRange(1, 1, 1, 8)
      .setBackground("#4A90D9").setFontColor("white").setFontWeight("bold")
      .setHorizontalAlignment("center").setVerticalAlignment("middle");
    sheet.setColumnWidth(1, 150); sheet.setColumnWidth(2, 150); sheet.setColumnWidth(3, 80);
    sheet.setColumnWidth(4, 400); sheet.setColumnWidth(5, 100);
    sheet.setColumnWidth(6, 200); sheet.setColumnWidth(7, 150); sheet.setColumnWidth(8, 60); sheet.setColumnWidth(9, 250);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ==========================================
// 기존 학생 시트 정렬 일괄 적용 (수동 실행용)
// ==========================================
function applyAlignmentToAllSheets() {
  var ss = getSS();
  var students = getStudentList();
  for (var s = 0; s < students.length; s++) {
    var sheet = ss.getSheetByName(students[s]);
    if (!sheet || sheet.getLastRow() < 1) continue;
    var lastRow = sheet.getLastRow();
    // A, B, C, E, F, G, H열 (내용 D열 제외) 가운데 정렬
    var colsToAlign = [1, 2, 3, 5, 6, 7, 8];
    for (var c = 0; c < colsToAlign.length; c++) {
      sheet.getRange(1, colsToAlign[c], lastRow, 1)
        .setHorizontalAlignment("center")
        .setVerticalAlignment("middle");
    }
    // D열(내용)은 수직만 위쪽, 수평은 왼쪽
    if (lastRow >= 1) {
      sheet.getRange(1, 4, lastRow, 1)
        .setHorizontalAlignment("left")
        .setVerticalAlignment("top");
    }
  }
  return { success: true, message: "정렬 적용 완료" };
}

function initConfigSheet(sheet) {
  sheet.getRange("A1").setValue("학생 이름").setFontWeight("bold");
  sheet.getRange("A1").setBackground("#34495E").setFontColor("white");
  sheet.setColumnWidth(1, 120);
}

function initTopicSheet(sheet) {
  sheet.getRange(1, 1, 1, 4).setValues([["주제ID", "주제 제목", "주제 안내", "등록일"]]);
  sheet.getRange(1, 1, 1, 4).setBackground("#34495E").setFontColor("white").setFontWeight("bold");
  sheet.setColumnWidth(1, 80); sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 350); sheet.setColumnWidth(4, 120);
  sheet.setFrozenRows(1);
}

function migrateData() {
  try {
    var ss = getSS();
    var configSheet = ss.getSheetByName("종합");
    if (!configSheet) return { success: false, message: "종합 시트 없음" };
    var msg = [];
    var lastRow = configSheet.getLastRow();

    if (lastRow >= 2) {
      var bData = configSheet.getRange(2, 2, lastRow - 1, 1).getValues();
      var students = [];
      for (var i = 0; i < bData.length; i++) {
        var n = bData[i][0].toString().trim();
        if (n !== "") students.push([n]);
      }
      if (students.length > 0) {
        configSheet.getRange("A2:A100").clearContent();
        configSheet.getRange(2, 1, students.length, 1).setValues(students);
        msg.push("학생 " + students.length + "명 이동");
      }
    }

    var topicSheet = getOrCreateSheet("주제");
    if (lastRow >= 2) {
      var gData = configSheet.getRange(2, 7, lastRow - 1, 4).getValues();
      var topicNextRow = Math.max(topicSheet.getLastRow() + 1, 2);
      var topicRows = [];
      for (var k = 0; k < gData.length; k++) {
        if (gData[k][0] && gData[k][1]) topicRows.push(gData[k]);
      }
      if (topicRows.length > 0) {
        topicSheet.getRange(topicNextRow, 1, topicRows.length, 4).setValues(topicRows);
        configSheet.getRange(2, 7, lastRow - 1, 4).clearContent();
        msg.push("주제 " + topicRows.length + "개 이동");
      }
    }

    configSheet.getRange("A1").setValue("학생 이름").setFontWeight("bold").setBackground("#34495E").setFontColor("white");
    return { success: true, message: msg.length > 0 ? msg.join(", ") + " 완료" : "이동할 데이터 없음" };
  } catch (e) {
    return { success: false, message: "오류: " + e.message };
  }
}

// ==========================================
// 통합 조회: 로그인 시 필요한 데이터 한번에
// studentName 검증 + topicList + studentWorks
// ==========================================
function loginAndGetData(studentName) {
  var cache = CacheService.getScriptCache();

  // 학생 목록 캐시 (120초)
  var studentsJson = cache.get('students_list');
  var students = studentsJson ? JSON.parse(studentsJson) : getStudentList();
  if (!studentsJson) {
    try { cache.put('students_list', JSON.stringify(students), 300); } catch(e) {}
  }

  var found = false;
  for (var i = 0; i < students.length; i++) {
    if (students[i] === studentName) { found = true; break; }
  }
  if (!found) return { valid: false };

  // 주제 목록 캐시 (120초)
  var topicsJson = cache.get('topic_list');
  var topics = topicsJson ? JSON.parse(topicsJson) : getTopicList();
  if (!topicsJson) {
    try { cache.put('topic_list', JSON.stringify(topics), 300); } catch(e) {}
  }

  var works = getStudentWorks(studentName);
  return { valid: true, topics: topics, works: works };
}

// ==========================================
// 통합 조회: 주제 선택 시 필요한 데이터 한번에
// draft + topWorks 동시 반환
// ==========================================
function selectTopicData(studentName, topicId) {
  try {
    var ss = getSS();

    // 모든 시트를 한 번에 가져오기
    var allSheets = ss.getSheets();
    var sheetMap = {};
    for (var k = 0; k < allSheets.length; k++) {
      sheetMap[allSheets[k].getName()] = allSheets[k];
    }

    // 1. Draft: 학생 본인 시트에서 읽기
    var draft = null;
    var mySheet = sheetMap[studentName];
    if (mySheet && mySheet.getLastRow() >= 2) {
      var myData = mySheet.getRange(2, 1, mySheet.getLastRow() - 1, 9).getValues();
      for (var i = myData.length - 1; i >= 0; i--) {
        if ((myData[i][2] ? myData[i][2].toString() : '') === topicId) {
          draft = {
            date:     myData[i][0] ? myData[i][0].toString() : '',
            title:    myData[i][1] ? myData[i][1].toString() : '',
            topicId:  topicId,
            content:  myData[i][3] ? myData[i][3].toString() : '',
            status:   myData[i][4] ? myData[i][4].toString() : '',
            feedback: myData[i][5] ? myData[i][5].toString() : '',
            star:     myData[i][7] ? Number(myData[i][7]) : 0,
            rowIndex: i + 2
          };
          break;
        }
      }
    }

    // 2. TopWorks: CacheService로 캐싱 (같은 주제 반복 조회 시 빠름)
    var cache = CacheService.getScriptCache();
    var cacheKey = 'topworks_' + topicId;
    var cached = cache.get(cacheKey);
    var topWorks = [];

    if (cached) {
      topWorks = JSON.parse(cached);
    } else {
      // 학생 목록도 캐시에서
      var studentsCacheKey = 'students_list';
      var studentsCache = cache.get(studentsCacheKey);
      var students = studentsCache ? JSON.parse(studentsCache) : getStudentList();
      if (!studentsCache) {
        cache.put(studentsCacheKey, JSON.stringify(students), 120);
      }

      var works = [];
      for (var s = 0; s < students.length; s++) {
        var name = students[s];
        var sheet = sheetMap[name];
        if (!sheet || sheet.getLastRow() < 2) continue;
        var lastRow = sheet.getLastRow();
        var data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
        for (var j = data.length - 1; j >= 0; j--) {
          if ((data[j][2] ? data[j][2].toString() : '') === topicId &&
              (data[j][4] ? data[j][4].toString() : '') === '과제완료') {
            var content = data[j][3] ? data[j][3].toString() : '';
            var star = data[j][7] ? Number(data[j][7]) : 0;
            var firstLine = (content.split('\n')[0] || '').trim();
            if (firstLine.length > 60) firstLine = firstLine.substring(0, 60) + '…';
            works.push({
              name: name,
              title: data[j][1] ? data[j][1].toString() : '',
              content: content,
              firstLine: firstLine,
              star: star,
              len: content.length
            });
            break;
          }
        }
      }
      works.sort(function(a, b) {
        return b.star !== a.star ? b.star - a.star : b.len - a.len;
      });
      topWorks = works.slice(0, 5);
      // 60초 캐시
      try { cache.put(cacheKey, JSON.stringify(topWorks), 60); } catch(e) {}
    }

    return { draft: draft, topWorks: topWorks };
  } catch(e) {
    Logger.log('selectTopicData 오류: ' + e.message);
    return { draft: null, topWorks: [] };
  }
}

// ==========================================
// 맞춤법 수정 기록 저장 (I열)
// ==========================================
function saveSpellingLog(studentName, topicId, spellLog) {
  try {
    var ss = getSS();
    var sheet = ss.getSheetByName(studentName);
    if (!sheet || sheet.getLastRow() < 2) return;

    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    for (var i = data.length - 1; i >= 0; i--) {
      if (data[i][0].toString() === topicId) {
        var targetRow = i + 2;
        // I열(9번째)에 맞춤법 수정 기록
        var cell = sheet.getRange(targetRow, 9);
        var existing = cell.getValue().toString().trim();
        // 기존 기록과 합쳐서 중복 제거
        var existingList = existing ? existing.split(', ') : [];
        var newList = spellLog ? spellLog.split(', ') : [];
        for (var ni = 0; ni < newList.length; ni++) {
          var word = newList[ni].trim();
          if (word && existingList.indexOf(word) === -1) {
            existingList.push(word);
          }
        }
        cell.setValue(existingList.join(', '));
        cell.setHorizontalAlignment('left');
        cell.setVerticalAlignment('middle');
        cell.setWrap(true);
        return;
      }
    }
  } catch(e) {
    Logger.log('맞춤법 기록 오류: ' + e.message);
  }
}

// ==========================================
// 글 다듬기 (OpenAI API)
// 학생 글을 주제에 맞게 자연스럽게 다듬기
// ==========================================
function refineText(text, topicTitle, topicGuide) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!apiKey) {
      return { error: 'API 키가 설정되지 않았습니다.' };
    }

    var systemPrompt = '당신은 초등학교 6학년 학생의 글쓰기를 도와주는 선생님입니다. '
      + '학생이 쓴 글을 더 자연스럽고 풍부하게 다듬어주세요. '
      + '단, 아래 규칙을 반드시 지켜주세요:\n'
      + '1. 학생이 쓴 내용과 의미는 절대 바꾸지 않습니다.\n'
      + '2. 초등학교 6학년 수준의 어휘와 문장을 사용합니다.\n'
      + '3. 문단 구분, 문장 연결, 표현을 자연스럽게 다듬습니다.\n'
      + '4. 다듬은 글만 출력하고 설명은 쓰지 않습니다.\n'
      + '5. 원본 길이의 1.5배를 넘지 않도록 합니다.';

    var userPrompt = '';
    if (topicTitle) userPrompt += '주제: ' + topicTitle + '\n';
    if (topicGuide) userPrompt += '주제 안내: ' + topicGuide + '\n';
    userPrompt += '\n다음 글을 다듬어주세요:\n\n' + text;

    var payload = {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    var code = response.getResponseCode();
    var body = response.getContentText();

    if (code === 401) return { error: 'API 키가 잘못됐습니다.' };
    if (code === 429) return { error: 'API 사용량 초과입니다. 잠시 후 다시 시도해주세요.' };
    if (code !== 200) return { error: 'API 오류 (' + code + ')' };

    var result = JSON.parse(body);
    var refined = result.choices[0].message.content.trim();

    return { refined: refined };

  } catch(e) {
    Logger.log('글 다듬기 오류: ' + e.message);
    return { error: e.message };
  }
}

// ==========================================
// 맞춤법 검사 (OpenAI API)
// 스크립트 속성에 OPENAI_API_KEY 저장 필요
// ==========================================
function checkSpelling(text) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!apiKey) {
      return { items: [], error: 'API 키가 설정되지 않았습니다.' };
    }

    // 글이 길면 500자씩 나눠서 검사
    var MAX_LEN = 500;
    var chunks = [];
    var paragraphs = text.split('\n');
    var chunk = '';
    for (var pi = 0; pi < paragraphs.length; pi++) {
      var para = paragraphs[pi];
      if ((chunk + '\n' + para).length > MAX_LEN && chunk) {
        chunks.push(chunk.trim());
        chunk = para;
      } else {
        chunk += (chunk ? '\n' : '') + para;
      }
    }
    if (chunk.trim()) chunks.push(chunk.trim());
    if (chunks.length === 0) chunks = [text.substring(0, MAX_LEN)];

    var allItems = [];
    var seen = {};

    for (var ci = 0; ci < chunks.length; ci++) {
      if (!chunks[ci].trim()) continue;
      var result = callOpenAI(chunks[ci], apiKey);
      if (result.error) return result;
      for (var i = 0; i < result.items.length; i++) {
        var key = result.items[i].original + '>>>' + result.items[i].corrected;
        if (!seen[key]) {
          seen[key] = true;
          allItems.push(result.items[i]);
        }
      }
    }

    return { items: allItems };

  } catch(e) {
    Logger.log('오류: ' + e.message);
    return { items: [], error: '오류: ' + e.message };
  }
}

function callOpenAI(text, apiKey) {
  try {
    var payload = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: '한국어 맞춤법 검사 전문가입니다. 실제로 틀린 것만 찾아주세요. 규칙: 1)띄어쓰기만 다른 경우는 포함하지 마세요. 2)올바른 표현은 포함하지 마세요. 3)original과 corrected가 같으면 포함하지 마세요. 반드시 순수 JSON만 응답하세요. 형식: {"items":[{"original":"틀린표현","corrected":"올바른표현","help":"간단한설명"}]} 오류 없으면 {"items":[]}'
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0,
      max_tokens: 1500,
      response_format: { type: 'json_object' }
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    var code = response.getResponseCode();
    var body = response.getContentText();

    Logger.log('응답코드: ' + code);

    if (code === 401) return { items: [], error: 'API 키가 잘못됐습니다.' };
    if (code === 429) return { items: [], error: 'API 사용량 초과입니다. 잠시 후 다시 시도해주세요.' };
    if (code !== 200) return { items: [], error: 'API 오류 (' + code + ')' };

    var result = JSON.parse(body);
    var content = result.choices[0].message.content.trim();
    Logger.log('GPT 응답: ' + content.substring(0, 200));

    var parsed = JSON.parse(content);
    var rawItems = parsed.items || [];

    // 공백 제거 후 비교 - 실질적으로 같은 항목 제외
    var filtered = [];
    for (var fi = 0; fi < rawItems.length; fi++) {
      var item = rawItems[fi];
      if (!item.original || !item.corrected) continue;
      var orig = item.original.replace(/\s+/g, '');
      var corr = item.corrected.replace(/\s+/g, '');
      // 공백 제거 후 같거나, help에 "오류가 없습니다" 포함되면 제외
      if (orig === corr) continue;
      if (item.help && item.help.indexOf('오류가 없') !== -1) continue;
      if (item.help && item.help.indexOf('맞춤법 오류가 없') !== -1) continue;
      filtered.push(item);
    }
    return { items: filtered };

  } catch(e) {
    Logger.log('callOpenAI 오류: ' + e.message);
    return { items: [], error: e.message };
  }
}

function testSpellCheck() {
  var result = checkSpelling('안녕하세요. 저는 학교에 갓다왔어요. 밥을못먹었어요.');
  Logger.log(JSON.stringify(result));
}

// Apps Script 편집기에서 직접 실행해서 테스트
function testSpellCheck() {
  var result = checkSpelling('안녕하세요. 저는 학교에 갓다왔어요. 밥을못먹었어요.');
  Logger.log(JSON.stringify(result));
}