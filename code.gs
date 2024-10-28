// 전체 동기화 계산
const RELATIVE_MAX_DAY = 1825; // 5 years = 365 days x 5 years
const RELATIVE_MIN_DAY = 30; // 30 days
const CALENDAR_NAME = 'primary';
const spreadsheetId = '1m0t1wQwdTyxN4o7HopswevacTZU_jqq12ZcYZXz7GTg';
const SKIP_BAD_EVENTS = true;

const TAGS_NOTION = "Tags";
const IGNORE_SYNC_TAG_NAME = "Ignore Sync";
const EVENT_ID_NOTION = "Event ID";
const CALENDAR_NAME_NOTION = "Calendar";
const CALENDAR_ID_NOTION = "Calendar ID";
const NAME_NOTION = "Task name";
const DESCRIPTION_NOTION = "Description";

const LAST_SYNC_NOTION = "Last Sync";

const LOCATION_NOTION = "Location";
//const NAME_NOTION = "Name";
const DATE_NOTION = "Date";

function unitTest(){
  // 단위테스트 하기
  test = getRelativeDate(-60,9);
  console.log(test)
}
/**
 * 변경된 캘린더 이벤트를 추출함
 *
 * @param {string} calendarId 캘런더 아이디
 * @param {boolean} fullSync 전체 동기화가 필요여부
 */
function logSyncedEvents(calendarId, fullSync) {
  const properties = PropertiesService.getUserProperties();
  const options = {
    maxResults: 100
  };
  const syncToken = properties.getProperty('syncToken');
  if (syncToken && !fullSync) {
    options.syncToken = syncToken;
  } else {
    // 60일전 캘린더까지 동기화함
    options.timeMin = getRelativeDate(-60, 0).toISOString();
  }
  // 페이지 단위로 일어옴.
  let events;
  let pageToken;
  do {
    try {
      options.pageToken = pageToken;
      events = Calendar.Events.list(calendarId, options);
    } catch (e) {
      // 동기화 토큰 검사
      // 전체 동기화 수행
      if (e.message === 'Sync token is no longer valid, a full sync is required.') {
        // 전체 동기화를 하는 경우 기존 동기화 토큰은 삭제함
        properties.deleteProperty('syncToken');
        logSyncedEvents(calendarId, true);
        return;
      }
      throw new Error(e.message);
    }
    

    addEvents(events.items, 'primary');
    pageToken = events.nextPageToken;
  } while (pageToken);
  // 다음 동기화를 위해 동기화 토큰 저장
  properties.setProperty('syncToken', events.nextSyncToken);
}

function addEvents(events, calendarName){
    if (events.items && events.items.length === 0) {
      console.log('발견된 이벤트 없음');
      return;
    }
    // Print the calendar events
    for (const event of events) {
      let when = event.start.dateTime;
      if (!when) {
        when = event.start.date;
      }
      let endtime = event.end.dateTime;
      if (!endtime) {
        endtime = event.end.date;
      }
    console.log('%s (%s)', event.summary, when);
    //구글시트에 셀에 캘린더 이벤트를 작성한다.
    addRow(event.id,event.etag, calendarName, when, endtime, event.summary, event.description,event.creator.email);
  }
}

/**
 * Lists 10 upcoming events in the user's calendar.
 * @see https://developers.google.com/calendar/api/v3/reference/events/list
 */
function listUpcomingEvents() {
  const calendarId = 'primary';
  // Add query parameters in optionalArgs
  const optionalArgs = {
    timeMin: (new Date()).toISOString(),
    showDeleted: false,
    singleEvents: true,
    maxResults: 10,
    orderBy: 'startTime'
    // use other optional query parameter here as needed.
  };
  try {
    // call Events.list method to list the calendar events using calendarId optional query parameter
    const response = Calendar.Events.list(calendarId, optionalArgs);
    const events = response.items;
    if (events.length === 0) {
      console.log('No upcoming events found');
      return;
    }
    // Print the calendar events
    for (const event of events) {
      let when = event.start.dateTime;
      if (!when) {
        when = event.start.date;
      }
      console.log('%s (%s)', event.summary, when);
    }
  } catch (err) {
    // TODO (developer) - Handle exception from Calendar API
    console.log('Failed with error %s', err.message);
  }
}

// 메인함수
function main(){
  parseNotionTokens();
  let modifiedEventIds = syncFromNotionToGoogleCal();

  for (var c_name of Object.keys(CALENDAR_IDS)) {
    syncFromGoogleCalToNotion(c_name, false, modifiedEventIds);
  }
}
/**
 * Syncs from google calendar to Notion
 * @param {String} calendarName 캘린더 이름
 * @param {Boolean} 전체 동기화 여부
 */
function syncFromGoogleCalToNotion(calendarName, initialSync) {
  console.log("[+ND] Syncing from Google Calendar: %s", calendarName);
  
  let properties = PropertiesService.getUserProperties();
  let options = {
    maxResults: 100,
    singleEvents: true, // 단독이벤트인지 반복이벤트인지 
  };
  
  let syncToken = properties.getProperty("syncToken");
  
  if (syncToken && !initialSync) {
    options.syncToken = syncToken;
  } else {
    // 과거 언제 부터
    options.timeMin = getRelativeDate(-RELATIVE_MIN_DAY, 0).toISOString();
    // 미래 언제까지 
    options.timeMax = getRelativeDate(RELATIVE_MAX_DAY, 0).toISOString();
  }

  // 한번에 한 페이지에 있는 이벤트들을 읽어오자
  let events;
  let pageToken;
  do {
    try {
      options.pageToken = pageToken;
      events = Calendar.Events.list(CALENDAR_IDS[calendarName], options);
      console.log(events);
    } catch (e) {
      
      console.log(e.message);
      console.log(e);
      // 동기화 토큰이 유효하지 않으면
      if (e.message.toLowerCase().indexOf("sync token") != -1) {
        resetSync(CALENDAR_NAME);
        return;
      } else {
        throw new Error(e.message);
      }
    }

    events["c_name"] = calendarName;

    if (events.items && events.items.length === 0) {
      console.log("이벤트 없음. %s", calendarName);
      return;
    }else{
      console.log(events.items);
    }

    //구글 캘린더 내용 읽기
    readEvents(events.items, calendarName);
    //노션에 쓰기
    editNotionPageWithGoogleCalendarEvents(events, modifiedEventIds);

    pageToken = events.nextPageToken;
  } while (pageToken);
  // 다음번 동기화를 위해 토큰 저장
  properties.setProperty("syncToken", events.nextSyncToken);
}

// 상대적 옵셋을 고려한 날짜 만들기
function getRelativeDate(daysOffset, hour) {
  let date = new Date();
  timezoneOffset = date.getTimezoneOffset();
  console.log(timezoneOffset/60 + "h");
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

// 구글 캘린더 이벤트 읽기
function readEvents(events, calendarName){
   if (events.length === 0) {
      console.log('신규 이벤트 없음');
      return;
    }
    // 
    for (const event of events) {
      let when = event.start.dateTime;
      if (!when) {
        when = event.start.date;
      }
      let endtime = event.end.dateTime;
      if (!endtime) {
        endtime = event.end.date;
      }
    
    // isExistingRow(event.id);
    addRow(event.id,event.etag, calendarName, when, endtime, event.summary, event.description,event.creator.email);
  }
}

/**
 * 구글 캘린더 이벤트를 읽어 노션페이지에 반영하기
 * @param {CalendarEvent[]} events 구글 캘린더 이벤트
 * @param {Set[String]} 무시할 이벤트.
 */
function editNotionPageWithGoogleCalendarEvents(events, ignoredEventIds) {
  let requests = [];
  for (let i = 0; i < events.items.length; i++) {
    let event = events.items[i];
    event["c_name"] = events["c_name"];
    
    if (ignoredEventIds.has(event.id)) {
      console.log("[+ND] Ignoring event %s", event.id);
      continue;
    }
    if (event.status === "cancelled") {
      console.log("[+ND] Event %s was cancelled.", event.id);
      // Remove the event from the database
      handleEventCancelled(event);
      continue;
    }

    let start;
    let end;
    let alldaylong = false;
    if (event.start.date) {
      // 종일 이벤트
      start = new Date(event.start.date);
      end = new Date(event.end.date);
      alldaylong = true;

      console.log(
        "종일 이벤트: %s %s (%s -- %s)",
        event.id,
        event.summary,
        start.toLocaleDateString(),
        end.toLocaleDateString()
      );
    } else {
      // 시간 이벤트
      start = event.start.dateTime;
      end = event.end.dateTime;

      console.log(
        "시간 이벤트 :  %s %s (%s)",
        event.id,
        event.summary,
        start.toLocaleString()
      );
    }
    let page_response = getPageFromEventID(event);
  
    alldaylong = false;

    if (page_response) {
      console.log(
        "이미 존재하는 이벤트이므로 변경할 부분 변경함",
        event.id,
        page_response.id
      );
      let tags = page_response.properties[TAGS_NOTION].multi_select;
      // 한꺼번에 요청을 보내기 위해 저장
      requests.push(
        addNotionTagsToRequestOptions(event, page_response.id, tags || [])
      );
      continue;
    }
    
    console.log("노션 페이지 신규 생성하는 요청으로 만들어 저장");

    try {
        requests.push(createNewNotionPageRequestOptions(event));
        console.log(event);
    } catch (err) {
      if (err instanceof InvalidEventError) {
        console.log(
          "유효하지 않은 이벤트 :  %s ",
          event.id
        );
        continue;
      }
      throw err;
    }
  }
  
  console.log("배치로 요청할 준비 :  %s", requests);

  const responses = UrlFetchApp.fetchAll(requests);

  for (let i = 0; i < responses.length; i++) {
    let response = responses[i];
    if (response.getResponseCode() === 401) {
      throw new Error("토큰 유효하지 않음");
    } else if (response.getResponseCode() === 404) {
      throw new Error("노션 페이지 없음");
    } else if (response.getResponseCode() === 403) {
      throw new Error("접근할 수 없는 노션 페이지.");
    } else if (response.getResponseCode() !== 200) {
      throw new Error(response.getContentText());
    }
  }
}

/**
 * 구글 캘린더에서 취소된 것 처리
 * @param {CalendarEvent} event 구글 캘린더 이벤트 객체
 */
function handleEventCancelled(event) {
  const page_id = getPageId(event);

  if (page_id) {
    addNotionTagsToRequestOptions(event, page_id, [], false);
  } else {
    console.log("노션 데이터베이스에 없는 이밴트는 생략 : %s ", event.id);
  }
}

/**
 * 구글 이벤트 정보로 노션 페이지 아이디 찾기
 * @param {CalendarEvent} event - 구글 이벤트 객체
 */
function getPageId(event) {
  const url = getDatabaseURL();
  const payload = {
    filter: {
      and: [
        { property: EVENT_ID_NOTION, rich_text: { equals: event.id } },
        {
          property: TAGS_NOTION,
          multi_select: {
            does_not_contain: IGNORE_SYNC_TAG_NAME,
          },
        },
      ],
    },
  };

  const response_data = notionFetch(url, payload, "POST");

  if (response_data.results.length > 0) {
    if (response_data.results.length > 1) {
      console.log(
        "Found multiple entries with event id %s. This should not happen. Only processing index zero entry.",
        event.id
      );
    }

    return response_data.results[0].id;
  }
  return null;
}

/**
 * 필터를 이용해서 페이지 가져오기
 * @param {CalendarEvent} event
 * @param {string|undefined} on_before_date 최신 동기화 날짜
 * @returns {*} 페이지 객체
 */

// https://developers.notion.com/reference/post-database-query-filter
function getPageFromEventID(event, on_before_date = null) {
  const url = getDatabaseURL();
  let payload = {
    filter: {
      and: [{ property: EVENT_ID_NOTION, rich_text: { equals: event.id } }],
    },
  };

  if (on_before_date) {
    payload["filter"]["and"].push({
      property: LAST_SYNC_NOTION,
      date: { on_or_before: new Date().toISOString(on_before_date) },
    });
  }

  const response_data = notionFetch(url, payload, "POST");
  
  if (response_data.results.length > 0) {
    if (response_data.results.length > 1) {
      console.log(
        "Found multiple entries with event id %s. This should not happen. Only considering index zero entry.",
        event.id
      );
    }

    return response_data.results[0];
  }
  return false;
}

/**
 * 신규 페이지 생성 요청문 작성
 * @param {CalendarEvent} event modified GCal event object
 * @returns {*} request object
 */
// https://developers.notion.com/reference/post-page

function createNewNotionPageRequestOptions(event) {
  const url = "https://api.notion.com/v1/pages";
  let payload = {};

  payload["parent"] = {
    type: "database_id",
    database_id: DATABASE_ID,
  };

  let properties = convertToNotionProperty(event);
  
  payload["properties"] = properties;

  if (!checkNotionProperty(payload["properties"])) {
    throw new InvalidEventError("Invalid Notion property");
  }

  let options = {
    url: url,
    method: "POST",
    headers: getNotionHeaders(),
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  };

  return options;
}

/**
 * 노션 속성 값 체크
 *
 * @param {*} properties 속성객체
 * @returns true 유효
 */
function checkNotionProperty(properties) {
  // 설명이 너무 긴지 체크
  if (properties[DESCRIPTION_NOTION].rich_text[0].text.content.length > 2000) {
    console.log("이벤트 설명이 너무 길다");
    return false;
  }

  return true;
}

/**
 * 노션 속성 객체로 변환하기
 * @param {CalendarEvent} event 구글 캘린더 이벤트
 * @param {String[]} existing_tags - 기존 태그
 * @returns {Object} 노션 속성 객체
 */
function convertToNotionProperty(event, existing_tags = []) {
  let properties = getCustomNotionProperties(event.id, event.c_name);

  properties[DESCRIPTION_NOTION] = {
    type: "rich_text",
    rich_text: [
      {
        text: {
          content: event.description || "",
        },
      },
    ],
  };

  properties[LOCATION_NOTION] = {
    type: "rich_text",
    rich_text: [
      {
        text: {
          content: event.location || "",
        },
      },
    ],
  };

  if (event.start) {
    let start_time;
    let end_time;

    if (event.start.date) {
      // 종일 이벤트
      start_time = new Date(event.start.date);
      end_time = new Date(event.end.date);

      // Offset timezone
      start_time.setTime(
        start_time.getTime() + start_time.getTimezoneOffset() * 60 * 1000
      );
      end_time.setTime(
        end_time.getTime() + end_time.getTimezoneOffset() * 60 * 1000
      );

      // 종료일에서 하루를 뺌
      end_time.setDate(end_time.getDate() - 1);

      start_time = start_time.toISOString().split("T")[0];
      end_time = end_time.toISOString().split("T")[0];

      end_time = start_time == end_time ? null : end_time;
    } else {
      // 시간 이벤트
      start_time = event.start.dateTime;
      end_time = event.end.dateTime;
    }

    properties[DATE_NOTION] = {
      type: "date",
      date: {
        start: start_time,
        end: end_time,
      },
    };

    properties[NAME_NOTION] = {
      type: "title",
      title: [
        {
          type: "text",
          text: {
            content: event.summary || "",
          },
        },
      ],
    };

  }

  if (event.status === "cancelled") {
    properties[TAGS_NOTION] = { multi_select: existing_tags };

    properties[TAGS_NOTION].multi_select.push({
      name: CANCELLED_TAG_NAME,
    });
  }

  return properties;
}
/**
 * 구글 캘린더 이벤트로 노션 요청 옵션문 작성
 * @param {CalendarEvent} event 구글 캘린더 이벤트
 * @param {String} page_id 노션 페이지 아이디
 * @param {String[]} existing_tags 기존 태그.
 * @param {Boolean} multi 멀티 패치
 * @returns {*} 
 */
function addNotionTagsToRequestOptions(event, page_id, existing_tags = [], multi = true) {
  let properties = convertToNotionProperty(event, existing_tags);

  return updatePagePropertiesRequestOptions(properties, page_id, multi);
}

// 동기화 토큰 삭제하고 동기화 다시 시작
function resetSync(calendarName){
  let properties = PropertiesService.getUserProperties();
  properties.deleteProperty("syncToken");
  syncFromGoogleCalToNotion(calendarName, true, new Set());
}

// 노션 요청 URL 만들기
function getDatabaseURL() {
  
  const userProperties = PropertiesService.getScriptProperties();
  DATABASE_ID= userProperties.getProperty('DATABASE_ID');

  return `https://api.notion.com/v1/databases/` + DATABASE_ID + `/query`;
}



// 노션에서 읽어와 구글에 쓸 이벤트 객체 만들기
function syncFromNotionToGoogleCal() {
  console.log("노션에서 읽어와 구글에 쓸 이벤트 객체 만들기");

  const url = getDatabaseURL();
  const payload = {
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    filter: {
      property: TAGS_NOTION,
      multi_select: {
        does_not_contain: IGNORE_SYNC_TAG_NAME,
      },
    },
  };
  const response_data = notionFetch(url, payload, "POST");

  let modifiedEventIds = new Set();

  for (let i = 0; i < response_data.results.length; i++) {
    let result = response_data.results[i];

    if (!isNotionPageUpdatedRecently(result)) {
      continue;
    }

    let event = changeDataForGoogleCalEvent(result);

    if (!event) {
      console.log(
        "해당 페이지 없음 %s ",
        result.id
      );
      continue;
    }

    let calendar_id = result.properties[CALENDAR_ID_NOTION].select;
    calendar_id = calendar_id ? calendar_id.name : null;

    let calendar_name = result.properties[CALENDAR_NAME_NOTION].select;
    calendar_name = calendar_name ? calendar_name.name : null;

    if (CALENDAR_IDS[calendar_name] && calendar_id && event.id) {
      if (calendar_id === CALENDAR_IDS[calendar_name]) {
        // 기존 이벤트 갱신
        updateGoogleCalEvent(event, event.id, calendar_id);
        continue;
      }
      // 신규 이벤트로 만들어서 옮기고 기존 것은 삭제
      let modified_eId;
      if (
        deleteGoogleEvent(event.id, calendar_id) &&
        (modified_eId = createGoogleCalendarEvent(result, event, calendar_name))
      ) {
        console.log("이벤트 %s 는 %s 로 옮겨짐", event.id, calendar_name);
        modified_eIds.add(modified_eId);

        continue;
      }

      console.log(
        "이벤트 %s 이동실패 %s.",
        event.id,
        calendar_name
      );

      continue;
    }

    calendar_name = checkCalendarName(calendar_name);

    if (CALENDAR_IDS[calendar_name]) {
      // 캘린더가 존재하면 거기에 생성
      let modifiedEventId;
      if ((modifiedEventId = createGoogleCalendarEvent(result, event, calendar_name))) {
        console.log("이벤트 생성됨 %s.", calendar_name);
        modifiedEventIds.add(modifiedEventId);
      }
      continue;
    }
    // 캘린더가 없으면 무시
    console.log(
      "캘린더 %s 없음",
      calendar_name
    );
  }
  return modifiedEventIds;
}
function checkCalendarName(name){
  if(name == null)
   return Object.keys(CALENDAR_IDS)[0];
  return "Primary";
}

/** 구글 캘린더 이벤트 갱신
 * @param {CalendarEvent} event - 구글 캘린더 이벤트
 * @param {String} page_id - 페이지 아이디
 * @param {String} calendar_id - 캘린더 아이디
 * @return {Boolean} True 성공
 */
function updateGoogleCalEvent(event, event_id, calendar_id) {
  event.summary = event.summary || "";
  event.description = event.description || "";
  event.location = event.location || "";

  try {
    let calendar = CalendarApp.getCalendarById(calendar_id);
    let cal_event = calendar.getEventById(event_id);

    cal_event.setDescription(event.description);
    cal_event.setTitle(event.summary);
    cal_event.setLocation(event.location);

    if (event.end && event.all_day) {
      // 종일, 여러날
      let shifted_date = new Date(event.end);
      shifted_date.setDate(shifted_date.getDate() + 2);
      cal_event.setAllDayDates(new Date(event.start), shifted_date);
    } else if (event.all_day) {
      // 종일, 하루
      cal_event.setAllDayDate(new Date(event.start));
    } else {
      // 시간 이벤트
      cal_event.setTime(new Date(event.start), new Date(event.end) || null);
    }
    return true;
  } catch (e) {
    console.log("이벤트 갱신 실패. %s", e);
    return false;
  }
}

/** 구글 캘린더 이벤트 삭제
 * @param {String} event_id - 이벤트 아이디
 * @param {String} calendar_id - 캘린더 아이디
 * @returns {Boolean} - True 삭제성공
 */
function deleteGoogleEvent(event_id, calendar_id) {
  console.log("Deleting event %s from gCal %s", event_id, calendar_id);
  try {
    let calendar = CalendarApp.getCalendarById(calendar_id);
    console.log("Deleting event %s from gCal %s", event_id, calendar_id);
    console.log(calendar);
    calendar.getEventById(event_id).deleteEvent();
    return true;
  } catch (e) {
    console.log(e);
    return false;
  }
}
/**
 * 이벤트 유효하지 않을 때 에러 처리
 */
class InvalidEventError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidEventError";
  }
}

/** 구글 캘린더 이벤트 생성 . 
 * @param {Object} page - 페이지 객체
 * @param {Object} event - 이벤트 객체
 * @param {String} calendar_name - 캘린더 이름
 * @return {String} - Event ID 성공시
 */
function createGoogleCalendarEvent(page, event, calendar_name) {
  event.summary = event.summary || "";
  event.description = event.description || "";
  event.location = event.location || "";

  let calendar_id = CALENDAR_IDS[calendar_name];
  let options = [event.summary, new Date(event.start)];

  if(event.start == null){
    console.log("event start is null %s", event.summary);
    return false;
  }

  if (event.end && event.all_day) {
    // 종일, 종료
    let shifted_date = new Date(event.end);
    shifted_date.setDate(shifted_date.getDate() + 1);
    options.push(shifted_date);
  } else if (event.end) {
    options.push(new Date(event.end));
  }

  options.push({ description: event.description, location: event.location });

  let calendar = CalendarApp.getCalendarById(calendar_id);
  try {
    console.log(calendar);
    let new_event = event.all_day
      ? calendar.createAllDayEvent(...options)
      : calendar.createEvent(...options);

    new_event_id = new_event.getId().split("@")[0];
  } catch (e) {
    console.log("신규 이벤트 생성 실패 %s", e);
    return false;
  }

  if (!new_event_id) {
    console.log("이벤트 [%s] 생성 실패.", event.summary);
    return false;
  }

  let properties = getCustomNotionProperties(new_event_id, calendar_name);
  updatePagePropertiesRequestOptions(properties, page.id);
  return new_event_id;
}

/**
 * 추가로 정의한 프라퍼티 정보 구성
 * @param {String} event_id - 이벤트 아이디
 * @param {String} calendar_name - 캘린더 이름
 * @returns {Object} - 추가한 속성 객체
 *  */
function getCustomNotionProperties(event_id, calendar_name) {
  return {
    [LAST_SYNC_NOTION]: {
      type: "date",
      date: {
        start: new Date().toISOString(),
      },
    },
    [EVENT_ID_NOTION]: {
      type: "rich_text",
      rich_text: [
        {
          text: {
            content: event_id, 
          },
        },
      ],
    },
    [CALENDAR_ID_NOTION]: {
      select: {
        name: CALENDAR_IDS[calendar_name],
      },
    },
    [CALENDAR_NAME_NOTION]: {
      select: {
        name: calendar_name,
      },
    },
  };
}

/**
 * 노션 속성으로 요청 또는 요청문 만들기 
 * @param {Object} properties
 * @param {String} page_id 페이지 아이디
 * @param {Boolean} multi 호출메소드 구분을 위해
 * @returns {*} URL옵션문 (멀티), 응답문(단일)
 */
// https://developers.notion.com/reference/patch-page

function updatePagePropertiesRequestOptions(
  properties,
  page_id,
  archive = false,
  multi = false
) {
  const url = "https://api.notion.com/v1/pages/" + page_id;
  let payload = {};

  payload["properties"] = properties;


  let options = {
    method: "PATCH",
    headers: getNotionHeaders(),
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  };

  if (multi) {
    options["url"] = url;
    return options;
  }

  return UrlFetchApp.fetch(url, options);
}

/**
 * 노션 API 호출
 * @param {String} url - 요청 url 
 * @param {Object} payload_dict - 요청문 페이로드
 * @param {String} method - 요청 방식
 * @returns {Object} 응답문
 */

function notionFetch(url, payload_dict, method = "POST"){
 let options = {
    method: method,
    headers: getNotionHeaders(),
    muteHttpExceptions: true,
    ...(payload_dict && { payload: JSON.stringify(payload_dict) }),
  };

  const response = UrlFetchApp.fetch(url, options);

  if (response.getResponseCode() === 200) {
    const response_data = JSON.parse(response.getContentText());
    if (response_data.length == 0) {
      throw new Error(
        "노션 API 응답없음. 노션 토큰 확인 요망."
      );
    }
    return response_data;
  } else if (response.getResponseCode() === 401) {
    throw new Error("노션 토큰 유효하지 않음.");
  } else {
    throw new Error(response.getContentText());
  } 
}


function getNotionHeaders() {
  return {
    Authorization: `Bearer ${NOTION_TOKEN}`,
    Accept: "application/json",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

/**
 * GAS에 저장했던 노션 토근과 디비아이디 값 읽어 오기
 */
function parseNotionTokens() {
  let properties = PropertiesService.getScriptProperties();
  NOTION_TOKEN = properties.getProperty("NOTION_TOKEN");

  let reURLInformation =
    /^(([^@:\/\s]+):\/?)?\/?(([^@:\/\s]+)(:([^@:\/\s]+))?@)?([^@:\/\s]+)(:(\d+))?(((\/\w+)*\/)([\w\-\.]+[^#?\s]*)?(.*)?(#[\w\-]+)?)?$/;

  DATABASE_ID = properties.getProperty("DATABASE_ID");
}


/** 최신 변경된 페이지인지 확인
 * @param {Object} page_result - 노션페이지
 * @return {Boolean} - True 최근변경됨
 * */
function isNotionPageUpdatedRecently(page_result) {
  let last_sync_date = page_result.properties[LAST_SYNC_NOTION];
  last_sync_date = last_sync_date.date ? last_sync_date.date.start : 0;
  return new Date(last_sync_date) < new Date(page_result.last_edited_time);
}

/**
 * 페이지 속성으로 구글 캘린더 이벤트 객체 만들기
 * @param {Object} page_result - 노션페이지
 * @returns {Object} - 못만들면 False
 */


function changeDataForGoogleCalEvent(page_result) {
  let e_id = page_result.properties[EVENT_ID_NOTION].rich_text;
  e_id = toRichText(e_id);
  
  let e_summary = page_result.properties[NAME_NOTION].title;
  
  e_summary = toRichText(e_summary);

  let e_description = page_result.properties[DESCRIPTION_NOTION].rich_text;
  e_description = toRichText(e_description);

  let e_location = page_result.properties[LOCATION_NOTION].rich_text;
  e_location = toRichText(e_location);

  let dates = page_result.properties[DATE_NOTION];

  if (dates.date) {
    let all_day = dates.date.end === null;

    if (dates.date.start && dates.date.start.search(/([A-Z])/g) === -1) {
      dates.date.start += "T00:00:00.000-05:00";
      all_day = true;
    } else if (
      !dates.date.end &&
      dates.date.start &&
      dates.date.start.search(/([A-Z])/g) !== -1
    ) {
      all_day = false;
      let default_end = new Date(dates.date.start);
      default_end.setMinutes(default_end.getMinutes() + 30);

      dates.date.end = default_end.toISOString();
    } else if (dates.date.end && dates.date.end.search(/([A-Z])/g) === -1) {
      dates.date.end += "T00:00:00.000-05:00";
      all_day = true;
    }

    let event = {
      ...(e_id && { id: e_id }),
      ...(e_summary && { summary: e_summary }),
      ...(e_description && { description: e_description }),
      ...(e_location && { location: e_location }),
      ...(dates.date.start && { start: dates.date.start }),
      ...(dates.date.end && { end: dates.date.end }),
      all_day: all_day,
    };
    return event;
  } else {
    return false;
  }
}

/**
 * 리치텍스트를 일반 문자열로 변환
 * @param {Object} rich_text_result 리치텍스트
 * @return {String} - 일반문자열
 * */
function toRichText(rich_text_result) {
  let plain_text = "";
  for (let i = 0; i < rich_text_result.length; i++) {
    plain_text += rich_text_result[i].rich_text
      ? rich_text_result[i].rich_text.plain_text
      : rich_text_result[i].plain_text;
  }
  return plain_text;
}

/** 구글 시트 동기화 연습 코드
 * Creates a Sheets API service object and prints the names and majors of
 * students in a sample spreadsheet:
 * https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit
 * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
 */
function logNamesAndMajors() {
  const spreadsheetId = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms';
  const rangeName = 'Class Data!A2:E';
  try {
    // Get the values from the spreadsheet using spreadsheetId and range.
    const values = Sheets.Spreadsheets.Values.get(spreadsheetId, rangeName).values;
    //  Print the values from spreadsheet if values are available.
    if (!values) {
      console.log('No data found.');
      return;
    }
    console.log('Name, Major:');
    for (const row in values) {
      // Print columns A and E, which correspond to indices 0 and 4.
      console.log(' - %s, %s', values[row][0], values[row][4]);
    }
  } catch (err) {
    // TODO (developer) - Handle Values.get() exception from Sheet API
    console.log(err.message);
  }
}

// https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app

function addRow(id,etag,calendarName, when, endtime, summary, description, creator) {
  
  //let values = [
  //  [
  //    when, summary
  //  ]
  //];
  var values = new Array(id, etag, when, endtime, calendarName, summary, description, creator);
  var dValues = new Array(values);
  //var sheet = SpreadsheetApp.getActiveSheet();
  var sheet = SpreadsheetApp.openById(spreadsheetId);
  //var range = sheet.getRange('A1');
  //sheet.getMaxRows();
  // sheet.appendRow(['Cotton Sweatshirt XL', 'css004']);
  var returenValue = isExistingRow(id);
  var range;
  if(returenValue > 0){
    range = sheet.getActiveSheet().getRange(returenValue,1,1,values.length);
    //console.log(range);
    range.setValues(dValues);
  }else{
    sheet.appendRow(values); 
    //insertRowValue(sheet, values, dValues);
  } 
}
function insertRowValue(sheet, values, dValues){
    sheet.insertRows(2);
    var range = sheet.getActiveSheet().getRange(2,1,1,values.length);
    //console.log(range);
    range.setValues(dValues);
}
function isExistingRow(id){
  var sheet = SpreadsheetApp.openById(spreadsheetId);
  var lastRow = sheet.getLastRow() > 0 ? sheet.getLastRow() : 1;
  var range = sheet.getActiveSheet().getRange(1, 1, lastRow,2);
  //var range = sheet.getActiveSheet().getRange(1, 1, 3, 3);
  console.log(range.getValues());
  
  var textFinder = range.createTextFinder(id);

  // Returns the first occurrence of 'dog'.
  var firstOccurrence = textFinder.findNext();
  var row = firstOccurrence != null ? firstOccurrence.getLastRow() : 0;

  if(row <= 0){
    console.log("not exist");
    return 0;
  }

  console.log(id);
  console.log(firstOccurrence.getLastRow());
  return row;
}


// https://github.com/hk21702/YA-GCal-Notion-Sync-Script/blob/08f9caa1a32f4bd245a990ff7c30e5255f18435f/README.md
