function main(){
  syncNotionToGoogleCalendar();
  syncGoogleCalendarToNotion();
}

// notion to gc
function syncNotionToGoogleCalendar() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID
  const calendarIds = scriptProperties.getProperty('calendarIds')?.split(',') || ['primary']; // 복수의 Google 캘린더 ID, 기본값은 'primary'

  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  try {
    const notionUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
    const payload = {
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending",
        },
      ],
    };

    const notionResponse = UrlFetchApp.fetch(notionUrl, {
      method: "post",
      contentType: "application/json",
      headers: notionHeaders,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const notionData = JSON.parse(notionResponse.getContentText());

    // 응답 데이터 검증
    if (!notionData || !notionData.results) {
      throw new Error("Invalid or empty response from Notion API.");
    }

    Logger.log(notionData);
    // 가져온 Task 목록
    const tasks = notionData.results.map((task) => {
      const properties = task.properties;
      const dueProperty = properties?.Due || null;
      const { start, end } = getStartAndEndTimes(dueProperty);

      Logger.log(properties);

      const data = {
        id: task.id, // Ensure the Notion page ID is captured
        name: properties?.["Task name"]?.title?.[0]?.plain_text || '(제목 없음)', // Corrected to handle title
        start,
        end,
        calendar: properties?.Calendar?.select?.name || null,
        location: properties?.Location?.rich_text?.[0]?.plain_text || null,
        // description: properties?.Description?.rich_text?.[0]?.plain_text || null,
        description: properties?.Summary?.rich_text?.[0]?.plain_text || null, // Use Notion Summary for description
        eventId: properties?.["Event ID"]?.rich_text?.[0]?.plain_text || null,
        // calendarId: properties?.["Calendar ID"]?.rich_text?.[0]?.plain_text || 'primary',
        calendarId: properties?.["Calendar ID"]?.select?.name || 'primary', // Google Calendar ID (select 타입)
        lastSync: properties?.["Last Sync"]?.date?.start || null,
        lastEditedTime: task.last_edited_time, // Built-in property
        etag: properties?.["Calendar Etag"]?.rich_text?.[0]?.plain_text || null,
      };
      Logger.log(data.eventId);
      Logger.log(data);
      return data;
    });

    // Google Calendar 동기화
    calendarIds.forEach((calendarId) => {
      // const calendarEvents = Calendar.Events.list(calendarId, getOptions()).items || [];
      const calendarEvents = fetchAllCalendarEvents(calendarId, getOptions()); // 모든 Google Calendar 이벤트 가져오기
      const existingEventIds = getExistingGcalEventIds(calendarId);

      tasks.forEach((task) => {
        Logger.log(`Processing Task: ${JSON.stringify(task)}`);

        // // Task의 Last Sync와 Google Calendar의 업데이트된 시간 비교 전 로그
        // Logger.log(`Task Last Sync: ${task.lastSync}`);
        // const event = calendarEvents.find(e => e.id === task.eventId);
        // Logger.log(`Event Updated Time: ${event?.updated || 'Not Found'}`);

        
        // if (shouldSkipTask(task.lastSync, task.lastEditedTime, event?.etag, task.etag)) {
        //   Logger.log(`Skipping task ${task.name} as it is already up-to-date.`);
        //   return;
        // }

        // const eventKey = `${task.calendarId}:${task.eventId}`;

        // if (task.eventId && existingEventIds.has(task.eventId)) {
        //   const event = {
        //     summary: task.name,
        //     description: task.description,
        //     location: task.location,
        //     start: task.start,
        //     end: task.end,
        //   };

        //   const updatedEvent = Calendar.Events.update(event, calendarId, task.eventId);
        //   const now = new Date().toISOString();
        //   updateNotionLastSync(task.id, now, notionHeaders);
        //   updateNotionEventId(task.id, updatedEvent.id, notionHeaders);
        //   updateNotionEtag(task.id, updatedEvent.etag, notionHeaders);
        //   Logger.log(`Updated event in calendar ${calendarId}: ${updatedEvent.id}`);
        // } else {
        //   const event = {
        //     summary: task.name,
        //     description: task.description,
        //     location: task.location,
        //     start: task.start,
        //     end: task.end,
        //   };
        //   const createdEvent = Calendar.Events.insert(event, calendarId);
        //   task.eventId = createdEvent.id;
        //   task.calendarId = calendarId;
        //   const now = new Date().toISOString();
        //   updateNotionLastSync(task.id, now, notionHeaders);
        //   updateNotionEventId(task.id, createdEvent.id, notionHeaders);
        //   updateNotionEtag(task.id, createdEvent.etag, notionHeaders);
        //   Logger.log(`Inserted new event in calendar ${calendarId}: ${createdEvent.id}`);
        // }
        if (task.eventId && task.calendarId) {
          const eventKey = `${task.calendarId}:${task.eventId}`;
          if (existingEventIds.has(eventKey)) {
            Logger.log(`Found matching event for Task ID ${task.id} in Calendar ID ${task.calendarId}`);
            const event = calendarEvents.find(e => e.id === task.eventId);

            if (shouldSkipTask(task.lastSync, task.lastEditedTime, event?.etag, task.etag)) {
              Logger.log(`Skipping Task ID ${task.id} as it is already up-to-date.`);
              return;
            }

            // Google Calendar 이벤트 업데이트
            const updatedEvent = updateGoogleCalendarEvent(task.calendarId, task);
            updateNotionTaskAfterSync(task, notionHeaders, updatedEvent);
            Logger.log(`Updated event in Calendar ID ${task.calendarId}: ${updatedEvent.id}`);
          } else {
            Logger.log(`Event ID ${task.eventId} not found in Calendar ID ${task.calendarId}`);
          }
        } else {
          Logger.log(`Creating new event for Task ID ${task.id} in Calendar ID ${calendarId}`);
          const newEvent = createGoogleCalendarEvent(calendarId, task);
          updateNotionTaskAfterSync(task, notionHeaders, newEvent);
          Logger.log(`Created new event in Calendar ID ${calendarId}: ${newEvent.id}`);
        }
      });
    });

    // 동기화 완료 시간 업데이트
    // scriptProperties.setProperty('lastSyncTime', new Date().toISOString());
  } catch (err) {
    console.error(`Error during sync (syncNotionToGoogleCalendar): ${err.message}`);
  }
}

// Create a new Google Calendar event
function createGoogleCalendarEvent(calendarId, task) {
  try {
    const event = {
      summary: task.name, // 이벤트 제목
      description: task.description, // 이벤트 설명
      location: task.location, // 이벤트 위치
    };

    // 시작과 종료 값 처리
    if (task.start && task.end) {
      if (task.start.date && task.end.date) {
        // 둘 다 `date` 형식일 경우
        event.start = { date: task.start.date };
        event.end = { date: task.end.date };
      } else if (task.start.dateTime && task.end.dateTime) {
        // 둘 다 `dateTime` 형식일 경우
        event.start = { dateTime: task.start.dateTime };
        event.end = { dateTime: task.end.dateTime };
      } else {
        throw new Error(
          "Start and end times must both be either `date` or `dateTime`."
        );
      }
    } else {
      throw new Error("Start and end times are required.");
    }

    const createdEvent = Calendar.Events.insert(event, calendarId); // 새 이벤트 생성
    Logger.log(`Successfully created event: ${createdEvent.id} in Calendar ID: ${calendarId}`);
    return createdEvent; // 생성된 이벤트 반환
  } catch (error) {
    Logger.log(`Failed to create event in Calendar ID: ${calendarId}, Error: ${error.message}`);
    throw error; // 에러를 상위 호출자로 전달
  }
}



function updateNotionTaskAfterSync(task, headers, syncedEvent) {
  if (!syncedEvent) {
    Logger.log(`No syncedEvent provided for task ${task.id}. Skipping updates.`);
    return; // syncedEvent가 없으면 동기화를 중단
  }

  try {
    const notionUpdateUrl = `https://api.notion.com/v1/pages/${task.id}`;
    const properties = {
      "Last Sync": {
        date: { start: new Date().toISOString() }, // 동기화 시점 갱신
      },
      "Event ID": {
        rich_text: [{ text: { content: syncedEvent.id } }], // Google Calendar Event ID
      },
      "Calendar ID": {
        select: { name: syncedEvent.calendarId || 'primary' }, // Google Calendar ID를 select 유형으로 전달
      },
      "Calendar Etag": {
        rich_text: [{ text: { content: syncedEvent.etag || '' } }], // Google Calendar Etag
      },
    };

    const payload = { properties };

    const response = UrlFetchApp.fetch(notionUpdateUrl, {
      method: 'patch',
      contentType: 'application/json',
      headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    if (response.getResponseCode() === 200) {
      Logger.log(`Successfully updated Notion Task ID: ${task.id}`);
    } else {
      Logger.log(`Failed to update Notion Task ID: ${task.id}, Response: ${response.getContentText()}`);
    }
  } catch (error) {
    Logger.log(`Error updating Notion Task ID: ${task.id}, Error: ${error.message}`);
    throw error; // 에러를 상위 호출자로 전달
  }
}

// Update an existing Google Calendar event
function updateGoogleCalendarEvent(calendarId, task) {
  try {
    const event = {
      summary: task.name, // 이벤트 제목
      description: task.description, // 이벤트 설명
      location: task.location, // 이벤트 위치
    };

    // 시작과 종료 값 처리
    if (task.start && task.end) {
      if (task.start.date && task.end.date) {
        // 둘 다 `date` 형식일 경우
        event.start = { date: task.start.date };
        event.end = { date: task.end.date };
      } else if (task.start.dateTime && task.end.dateTime) {
        // 둘 다 `dateTime` 형식일 경우
        event.start = { dateTime: task.start.dateTime };
        event.end = { dateTime: task.end.dateTime };
      } else {
        throw new Error(
          "Start and end times must both be either `date` or `dateTime`."
        );
      }
    } else {
      throw new Error("Start and end times are required.");
    }

    const updatedEvent = Calendar.Events.update(event, calendarId, task.eventId); // 이벤트 업데이트
    Logger.log(`Successfully updated event: ${updatedEvent.id} in Calendar ID: ${calendarId}`);
    return updatedEvent; // 업데이트된 이벤트 반환
  } catch (error) {
    Logger.log(`Failed to update event in Calendar ID: ${calendarId}, Event ID: ${task.eventId}, Error: ${error.message}`);
    throw error; // 에러를 상위 호출자로 전달
  }
}



function shouldSkipTask(lastSync, lastEditedTime, eventEtag, taskEtag) {
  if (!lastSync || !taskEtag) return false;

  const lastSyncDate = new Date(lastSync);
  const lastEditedDate = new Date(lastEditedTime);

  Logger.log(`Comparing Last Sync (${lastSync}) with Last Edited Time (${lastEditedTime}) and etags (Event: ${eventEtag}, Task: ${taskEtag})`);

  // Check if the last sync is up-to-date based on last edited time and etag
  return lastSyncDate >= lastEditedDate && eventEtag === taskEtag;
}

function updateNotionLastSync(pageId, syncTime, headers) {
  const notionUpdateUrl = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "Last Sync": {
        date: {
          start: syncTime,
        },
      },
    },
  };

  const response = UrlFetchApp.fetch(notionUpdateUrl, {
    method: "patch",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to update Last Sync for page ${pageId}: ${response.getContentText()}`);
  } else {
    Logger.log(`Last Sync updated for page ${pageId}`);
  }
}

function updateNotionEtag(pageId, etag, headers) {
  const notionUpdateUrl = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "Calendar Etag": {
        rich_text: [
          {
            text: {
              content: etag,
            },
          },
        ],
      },
    },
  };

  const response = UrlFetchApp.fetch(notionUpdateUrl, {
      method: "patch",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to update Calendar Etag for page ${pageId}: ${response.getContentText()}`);
  } else {
    Logger.log(`Calendar Etag updated for page ${pageId}`);
  }
}

function getExistingGcalEventIds(calendarId) {
  const calendarEvents = Calendar.Events.list(calendarId, getOptions()).items || [];
  Logger.log(`Calendar Events for Calendar ID ${calendarId}: ${JSON.stringify(calendarEvents)}`);

  // Safely map `calendarId:eventId` values
  const existingEventIds = new Set(
    calendarEvents
      .map((event) => {
        if (event.id) {
          const eventKey = `${calendarId}:${event.id}`; // Combine Calendar ID and Event ID
          Logger.log(`Found Event Key: ${eventKey}`);
          return eventKey;
        } else {
          Logger.log(`Event without ID in Calendar ${calendarId}: ${JSON.stringify(event)}`);
          return null;
        }
      })
      .filter(Boolean) // Remove null or undefined keys
  );

  Logger.log(`Existing Event Keys for Calendar ID ${calendarId}: ${[...existingEventIds]}`);
  return existingEventIds;
}


function getOptions(){
  // Calculate the date range: 30 days ago to today
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);
  const thirtyDaysLater = new Date();
  thirtyDaysLater.setDate(today.getDate() + 30);

  // Format dates to ISO strings
  const timeMin = thirtyDaysAgo.toISOString();
  const timeMax = thirtyDaysLater.toISOString();

  // Fetch calendar events within the date range
  const options = {
    timeMin: timeMin,
    timeMax: timeMax,
    singleEvents: true,
    showDeleted: false
  };

  return options;
}
// notion to gc


// gc to notion
function resetGCToNotion(){
  syncGoogleCalendarToNotion(true);
}

function syncGoogleCalendarToNotion(forceSync = false) {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID
  const calendarIds = scriptProperties.getProperty('calendarIds')?.split(',') || ['primary']; // 복수의 Google 캘린더 ID, 기본값은 'primary'
  const backupFolderId = scriptProperties.getProperty('backupFolderId');


  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  try {
    const calendarOptions = getCalendarOptions(); // 동기화 범위 설정
    calendarIds.forEach((calendarId) => {
      // const calendarEvents = Calendar.Events.list(calendarId, getCalendarOptions()).items || [];
      const calendarEvents = fetchAllCalendarEvents(calendarId, calendarOptions); // Google Calendar 이벤트 가져오기
      const notionTasks = getNotionTasks(notionHeaders, databaseId);

      const existingNotionEventIds = new Set(
        notionTasks.map((task) => task.eventId).filter(Boolean)
      );
      // const existingCalendarEventIds = new Set(calendarEvents.map((event) => event.id).filter(Boolean));

      // Google Calendar에 없는 Notion 작업 삭제 처리
      handleNotionTaskDeletion(notionTasks, calendarEvents, calendarOptions, backupFolderId, notionHeaders);
      // Notion에 없는 Google Calendar 이벤트 삭제 처리
      // handleCalendarEventDeletion(calendarEvents, notionTasks, calendarOptions, backupFolderId, calendarId);

      calendarEvents.forEach((event) => {
        const eventId = event.id;
        Logger.log(`Processing Calendar Event: ${eventId}`);

        if (existingNotionEventIds.has(eventId)) {
          const task = notionTasks.find((t) => t.eventId === eventId);

          if (forceSync || isEventUpdated(event.updated, task.lastSync, event.etag, task.etag)) {
            Logger.log(`Updating Notion Task for Event ID: ${eventId}`);
            updateNotionTaskFromEvent(task.id, event, notionHeaders);
          } else {
            Logger.log(`Skipping Notion Task Update for Event ID: ${eventId}, already up-to-date.`);
          }
        } else {
          Logger.log(`Creating new Notion Task for Event ID: ${eventId}`);
          createNotionTaskFromEvent(event, databaseId, notionHeaders);
        }
      });
    });
  } catch (err) {
    console.error(`Error during sync (syncGoogleCalendarToNotion): ${err.message}`);
  }
}

function testDeletedGC(){
  listDeletedEvents('primary');
}
function listDeletedEvents(calendarId) {
    const now = new Date();
  const past = new Date(now);
  const future = new Date(now);

  past.setDate(now.getDate() - 30); // 30일 전
  future.setDate(now.getDate() + 30); // 30일 후

  const options = {
    timeMin: past.toISOString(), // 30일 전부터
    timeMax: future.toISOString(), // 30일 후까지
    showDeleted: true, // 삭제된 이벤트 포함
    singleEvents: true, // 반복 이벤트를 각각 가져옴
    orderBy: "startTime", // 시작 시간 기준 정렬
  };

  const response = Calendar.Events.list(calendarId, options);
  const events = response.items;

  if (events.length === 0) {
    Logger.log("No events found.");
    return;
  }

  events.forEach((event) => {
    if (event.status === "cancelled") {
      Logger.log(`Deleted Event Found: ID = ${event.id}, Summary = ${event.summary || "(No Title)"}`);
    }
  });
}


// Google Calendar 이벤트를 모두 가져오는 함수
function fetchAllCalendarEvents(calendarId, calendarOptions) {
  let events = [];
  let pageToken = null;

  do {
    const options = { ...calendarOptions, pageToken: pageToken }; // 페이지 토큰 추가
    const response = Calendar.Events.list(calendarId, options); // Google Calendar API 호출
    events = events.concat(response.items || []); // 현재 페이지의 이벤트 추가
    pageToken = response.nextPageToken; // 다음 페이지 토큰 갱신
  } while (pageToken); // 다음 페이지가 없을 때까지 반복

  return events;
}

function getNotionTasks(headers, databaseId) {
  const notionUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const payload = {
    sorts: [
      {
        timestamp: "last_edited_time",
        direction: "descending",
      },
    ],
  };

  const notionResponse = UrlFetchApp.fetch(notionUrl, {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const notionData = JSON.parse(notionResponse.getContentText());

  if (!notionData || !notionData.results) {
    throw new Error("Invalid or empty response from Notion API.");
  }

  return notionData.results.map((task) => {
    const properties = task.properties;

    return {
      id: task.id,
      name: properties?.["Task name"]?.title?.[0]?.plain_text || '(제목 없음)',
      eventId: properties?.["Event ID"]?.rich_text?.[0]?.plain_text || null,
      lastSync: properties?.["Last Sync"]?.date?.start || null,
      etag: properties?.["Calendar Etag"]?.rich_text?.[0]?.plain_text || null,
      calendarId: properties?.["Calendar ID"]?.select?.name || 'primary', // Google Calendar ID (select 타입)
    };
  });
}

function isEventUpdated(eventUpdatedTime, lastSyncTime, eventEtag, notionEtag) {
  if (!lastSyncTime || !notionEtag) return true;

  const eventUpdatedDate = new Date(eventUpdatedTime);
  const lastSyncDate = new Date(lastSyncTime);

  // 이벤트가 최신 업데이트되었거나 etag가 다르면 업데이트 필요
  return eventUpdatedDate > lastSyncDate || eventEtag !== notionEtag;
}

function updateNotionTaskFromEvent(taskId, event, headers) {
  const notionUpdateUrl = `https://api.notion.com/v1/pages/${taskId}`;
  const payload = {
    properties: {
      "Task name": {
        title: [
          {
            text: {
              content: event.summary || '(제목 없음)',
            },
          },
        ],
      },
      "Due": {
        date: {
          start: event.start.dateTime || event.start.date,
          end: event.end?.dateTime || event.end?.date || null,
        },
      },
      "Last Sync": {
        date: {
          start: new Date().toISOString(),
        },
      },
      "Calendar Etag": {
        rich_text: [
          {
            text: {
              content: event.etag || '',
            },
          },
        ],
      },
      "Calendar ID": {
        select: { 
          name: event.calendarId || 'primary' 
          }, // Google Calendar ID를 select 유형으로 전달
      },
      "Summary": {
        rich_text: [
          {
            text: {
              content: event.description || '',
            },
          },
        ],
      },
    },
  };

  const response = UrlFetchApp.fetch(notionUpdateUrl, {
    method: "patch",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to update Notion Task ${taskId}: ${response.getContentText()}`);
  } else {
    Logger.log(`Successfully updated Notion Task ${taskId}`);
  }
}

function createNotionTaskFromEvent(event, databaseId, headers) {
  const notionCreateUrl = `https://api.notion.com/v1/pages`;
  const payload = {
    parent: { database_id: databaseId },
    properties: {
      "Task name": {
        title: [
          {
            text: {
              content: event.summary || '(제목 없음)',
            },
          },
        ],
      },
      "Due": {
        date: {
          start: event.start.dateTime || event.start.date,
          end: event.end?.dateTime || event.end?.date || null,
        },
      },
      "Event ID": {
        rich_text: [
          {
            text: {
              content: event.id,
            },
          },
        ],
      },
      "Last Sync": {
        date: {
          start: new Date().toISOString(),
        },
      },
      "Calendar Etag": {
        rich_text: [
          {
            text: {
              content: event.etag || '',
            },
          },
        ],
      },
      "Calendar ID": {
        select: { 
          name: event.calendarId || 'primary' 
          }, // Google Calendar ID를 select 유형으로 전달
      },
      "Summary": {
        rich_text: [
          {
            text: {
              content: event.description || '',
            },
          },
        ],
      },
    },
  };

  const response = UrlFetchApp.fetch(notionCreateUrl, {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to create Notion Task for Event ID ${event.id}: ${response.getContentText()}`);
  } else {
    Logger.log(`Successfully created Notion Task for Event ID ${event.id}`);
  }
}

function getCalendarOptions() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const daysBefore = parseInt(scriptProperties.getProperty('daysBefore')) || 30; // 기본값 30일 전
  const daysAfter = parseInt(scriptProperties.getProperty('daysAfter')) || 30; // 기본값 30일 후

  const now = new Date();
  const past = new Date(now);
  const future = new Date(now);

  past.setDate(now.getDate() - daysBefore);
  future.setDate(now.getDate() + daysAfter);

  return {
    timeMin: past.toISOString(),
    timeMax: future.toISOString(),
    showDeleted: false,
    singleEvents: true,
    orderBy: 'startTime',
  };
}

function isWithinSyncRange(date, timeMin, timeMax) {
  if (!date) return false;
  const targetDate = new Date(date);
  const minDate = new Date(timeMin);
  const maxDate = new Date(timeMax);
  return targetDate >= minDate && targetDate <= maxDate;
}
function deleteNotionTask(pageId, headers) {
  const notionDeleteUrl = `https://api.notion.com/v1/pages/${pageId}`;
  const response = UrlFetchApp.fetch(notionDeleteUrl, {
    method: "delete",
    contentType: "application/json",
    headers,
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to delete Notion Task ${pageId}: ${response.getContentText()}`);
  } else {
    Logger.log(`Successfully deleted Notion Task ${pageId}`);
  }
}
function deleteGoogleCalendarEvent(calendarId, eventId) {
  try {
    // Logger.log(`${calendarId}, ${eventId}`);
    Calendar.Events.delete(calendarId, eventId);
    
    // const event = CalendarApp.getEventById(eventId);
    // event.deleteEvent();

    Logger.log(`Successfully deleted Google Calendar Event ID: ${calendarId} ${eventId}`);
  } catch (err) {
    Logger.log(`Failed to delete Google Calendar Event ID (deleteGoogleCalendarEvent):${calendarId} ${eventId}: ${err.message}`);
  }
}

function saveToDriveAsJson(filename, data, folderId) {
  try {
    if(!folderId){
      return;
    }
    if (!data || typeof data !== "object") {
      throw new Error("Data to save must be a valid object.");
    }
    Logger.log(`${filename}, ${data}, ${folderId}`);
    const folder = DriveApp.getFolderById(folderId); // 폴더 ID로 Google Drive 폴더 가져오기
    const jsonFile = folder.createFile(filename, JSON.stringify(data, null, 2), "application/json");//MimeType.JSON); // JSON 파일 생성
    Logger.log(`Saved backup to Google Drive: ${jsonFile.getUrl()}`); // 저장된 파일 URL 로깅
  } catch (error) {
    Logger.log(`Failed to save JSON file to Drive. Filename: ${filename}, Error: ${error.message}`); // 에러 로깅
    throw error; // 에러를 상위 호출자로 전달
  }
}
function testMimeType() {
  Logger.log(`MimeType.JSON: ${MimeType.JSON}`);
}

function deleteGoogleCalendarEventWithBackup(calendarId, eventId, event, folderId) {
  try {
    saveToDriveAsJson(`calendar_event_${eventId}.json`, event, folderId);
    // Logger.log(`${calendarId}, ${eventId}`);
    Calendar.Events.delete(calendarId, eventId);
    Logger.log(`Successfully deleted Google Calendar Event ID: ${calendarId} ${eventId}`);
  } catch (err) {
    Logger.log(`Failed to delete Google Calendar Event ID(deleteGoogleCalendarEventWithBackup): ${calendarId} ${eventId}: ${err.message}`);
  }
}
function deleteNotionTaskWithBackup(pageId, task, folderId, headers) {
  try {
    saveToDriveAsJson(`notion_task_${pageId}.json`, task, folderId);
    const notionDeleteUrl = `https://api.notion.com/v1/pages/${pageId}`;
    Logger.log(`${notionDeleteUrl}`);

    // API 요청 페이로드
    const payload = {
      archived: true, // 페이지를 아카이브 처리
    };

    // API 요청
    const response = UrlFetchApp.fetch(notionDeleteUrl, {
      method: "patch", // PATCH 메서드 사용
      contentType: "application/json",
      headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    // const response = UrlFetchApp.fetch(notionDeleteUrl, {
    //   method: "delete",
    //   contentType: "application/json",
    //   headers,
    //   muteHttpExceptions: true,
    // });

    if (response.getResponseCode() !== 200) {
      Logger.log(`Failed to delete Notion Task ${pageId}: ${response.getContentText()}`);
    } else {
      Logger.log(`Successfully deleted Notion Task ${pageId}`);
    }
  } catch (err) {
    Logger.log(`Error during Notion Task deletion for ${pageId}: ${err.message}`);
  }
}
function restoreGoogleCalendarEventFromJson(folderId, filename, calendarId) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(filename);

  if (!files.hasNext()) {
    Logger.log(`File ${filename} not found in folder ${folderId}`);
    return;
  }

  const file = files.next();
  const eventData = JSON.parse(file.getBlob().getDataAsString());

  const restoredEvent = Calendar.Events.insert(eventData, calendarId);
  Logger.log(`Restored Google Calendar Event: ${restoredEvent.id}`);
}
function restoreNotionTaskFromJson(folderId, filename, databaseId, headers) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(filename);

  if (!files.hasNext()) {
    Logger.log(`File ${filename} not found in folder ${folderId}`);
    return;
  }

  const file = files.next();
  const taskData = JSON.parse(file.getBlob().getDataAsString());

  const notionCreateUrl = `https://api.notion.com/v1/pages`;
  const payload = {
    parent: { database_id: databaseId },
    properties: taskData.properties, // 기존 속성을 복원
  };

  const response = UrlFetchApp.fetch(notionCreateUrl, {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (response.getResponseCode() !== 200) {
    Logger.log(`Failed to restore Notion Task from file ${filename}: ${response.getContentText()}`);
  } else {
    Logger.log(`Successfully restored Notion Task from file ${filename}`);
  }
}

function restoreAction(){
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID
  const calendarIds = scriptProperties.getProperty('calendarIds')?.split(',') || ['primary']; // 복수의 Google 캘린더 ID, 기본값은 'primary'
  const backupFolderId = scriptProperties.getProperty('backupFolderId');

  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  // Google Calendar 이벤트 복원
  restoreGoogleCalendarEventFromJson(backupFolderId, 'calendar_event_eventId123.json', calendarIds);

  // Notion 작업 복원
  restoreNotionTaskFromJson(backupFolderId, 'notion_task_pageId123.json', databaseId, notionHeaders);
}

// Google Calendar에 없는 Notion 작업 삭제 처리
// Handle Notion task deletion based on Google Calendar cancelled events
function handleNotionTaskDeletion(notionTasks, calendarEvents, calendarOptions, backupFolderId, notionHeaders) {
  // Google Calendar에서 삭제된 이벤트만 필터링
  const cancelledEvents = calendarEvents.filter(
    (event) => event.status === "cancelled" // 삭제된 상태인지 확인
  );

  cancelledEvents.forEach((cancelledEvent) => {
    const eventId = cancelledEvent.id;

    // Notion 작업 중 삭제된 Google Calendar 이벤트와 일치하는 작업을 찾음
    const taskToDelete = notionTasks.find((task) => task.eventId === eventId);

    if (taskToDelete) {
      // 동기화 범위 내인지 확인
      if (isWithinSyncRange(taskToDelete.lastSync, calendarOptions.timeMin, calendarOptions.timeMax)) {
        Logger.log(`Backing up and deleting Notion Task for cancelled Calendar Event ID: ${eventId}`);

        // 삭제된 작업을 백업하고 삭제
        saveToDriveAsJson(`notion_task_${taskToDelete.id}.json`, taskToDelete, backupFolderId);
        deleteNotionTaskWithBackup(taskToDelete.id, taskToDelete, backupFolderId, notionHeaders);
      } else {
        Logger.log(`Notion Task ${taskToDelete.id} is out of sync range, skipping delete.`);
      }
    } else {
      Logger.log(`No matching Notion Task found for cancelled Calendar Event ID: ${eventId}`);
    }
  });
}


// Notion에 없는 Google Calendar 이벤트 삭제 처리
// Notion에 없는 Google Calendar 이벤트 삭제 처리 (archived 조건 기반)
function handleCalendarEventDeletion(calendarEvents, backupFolderId, calendarId) {
  const archivedNotionTasks = fetchArchivedNotionTasksWithCustomProperties(); // archived: true 조건으로 Notion 작업 가져오기

  calendarEvents.forEach((event) => {
    const eventId = event.id;

    // archived된 Notion 작업 중에 Google Calendar Event ID와 일치하는 작업이 있는지 확인
    if (archivedNotionTasks.find((task) => task.eventId === eventId)) {
      Logger.log(`Backing up and deleting Calendar Event for archived Notion Task: ${eventId}`);
      saveToDriveAsJson(`calendar_event_${eventId}.json`, event, backupFolderId); // 백업
      deleteGoogleCalendarEventWithBackup(calendarId, eventId, event, backupFolderId); // Google Calendar 이벤트 삭제
    } else {
      Logger.log(`Calendar Event ${eventId} is not associated with an archived Notion Task.`);
    }
  });
}

// Fetch archived Notion tasks and read Event ID and Calendar ID
function fetchArchivedNotionTasksWithCustomProperties() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID

  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const payload = {
    filter: {
      property: "archived",
      checkbox: {
        equals: true,
      },
    },
    sorts: [
      {
        timestamp: "last_edited_time",
        direction: "descending",
      },
    ],
  };

  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      headers: notionHeaders,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const data = JSON.parse(response.getContentText());

    if (!data.results || data.results.length === 0) {
      Logger.log("No archived tasks found.");
      return [];
    }

    const archivedTasks = data.results.map((task) => {
      const properties = task.properties;
      return {
        id: task.id,
        name: properties?.["Task name"]?.title?.[0]?.plain_text || "(Untitled)",
        eventId: properties?.["Event ID"]?.rich_text?.[0]?.plain_text || null,
        // calendarId: properties?.["Calendar ID"]?.rich_text?.[0]?.plain_text || 'primary',
        calendarId: properties?.["Calendar ID"]?.select?.name || 'primary', // Google Calendar ID (select 타입)
      };
    });

    Logger.log(`Archived Tasks: ${JSON.stringify(archivedTasks, null, 2)}`);
    return archivedTasks;
  } catch (error) {
    Logger.log(`Error fetching archived Notion tasks: ${error.message}`);
    throw error;
  }
}


// 새롭게 추가된 Notion 작업 처리
function handleNewNotionTasks(notionTasks, calendarId, notionHeaders) {
  notionTasks.forEach((task) => {
    if (!task.eventId && !task.lastSync) { // 이벤트 ID와 동기화 기록이 없는 경우
      Logger.log(`Task ${task.name} is a new Task without sync history. Creating event in Google Calendar.`);
      createGoogleCalendarEventFromTask(task, calendarId, notionHeaders); // Google Calendar에 새 이벤트 생성
    } else {
      Logger.log(`Task ${task.name} is already synced or updated.`); // 이미 동기화된 작업은 처리하지 않음
    }
  });
}



// gc to notion


function testEventIdComparison() {
  const calendarId = 'primary'; // Google Calendar ID
  const notionTasks = [
    {
      id: "notion-task-1",
      eventId: "tr0qvae2h3h0rjgh5bhkqsoi7g", // Example Event ID
      name: "Sample Task 1"
    },
    {
      id: "notion-task-2",
      eventId: "sqjmpvrn4593c4ug66sq4el1ko", // Example Event ID
      name: "Sample Task 2"
    },
    {
      id: "notion-task-3",
      eventId: "cklivd77vp5iju1es9haet79j8", // Nonexistent Event ID
      name: "Sample Task 3"
    }
  ];

  // Fetch Google Calendar events
  const calendarEvents = Calendar.Events.list(calendarId, getOptions()).items || [];
  Logger.log(`Google Calendar Events: ${JSON.stringify(calendarEvents)}`);

  // Extract existing Event IDs
  const existingEventIds = new Set(
    calendarEvents.map(event => event.id.trim())
  );
  Logger.log(`Existing Event IDs in Google Calendar: ${[...existingEventIds]}`);

  // Compare Notion Event IDs with Google Calendar Event IDs
  notionTasks.forEach(task => {
    if (!task.eventId) {
      Logger.log(`Task ${task.name} has no Event ID.`);
    } else if (existingEventIds.has(task.eventId.trim())) {
      Logger.log(`Task ${task.name} matches with Event ID: ${task.eventId}`);
    } else {
      Logger.log(`Task ${task.name} does not match any Event ID in Google Calendar.`);
    }
  });
}

function getStartAndEndTimes(dueProperty) {
  let start, end;
  const now = new Date().toISOString(); // Current date and time in ISO format
  const today = now.split("T")[0]; // Current date only (YYYY-MM-DD)

  if (dueProperty?.date) {
    if (dueProperty.date.start?.includes("T")) {
      // dateTime format
      const startTime = new Date(dueProperty.date.start);
      const endTime = dueProperty.date.end
        ? new Date(dueProperty.date.end)
        : new Date(startTime.getTime() + 3600000); // Default end time: 1 hour after start
      start = { dateTime: startTime.toISOString(), timeZone: "UTC" };
      end = { dateTime: endTime.toISOString(), timeZone: "UTC" };

      // Validation: Ensure end is after start
      if (endTime <= startTime) {
        end = { dateTime: new Date(startTime.getTime() + 3600000).toISOString(), timeZone: "UTC" }; // End = start + 1 hour
      }
    } else {
      // date format (all-day events)
      start = { date: dueProperty.date.start || today };
      const endDate = dueProperty.date.end
        ? new Date(dueProperty.date.end)
        : new Date(dueProperty.date.start || today);
      end = { date: new Date(endDate.getTime() + 86400000).toISOString().split("T")[0] }; // End = endDate + 1 day
    }
  } else {
    // If no Due property, use today as default
    start = { date: today };
    end = { date: today };
  }

  return { start, end };
}

function updateNotionEventId(pageId, eventId, headers) {
  const notionUpdateUrl = `https://api.notion.com/v1/pages/${pageId}`;
  const payload = {
    properties: {
      "Event ID": {
        rich_text: [
          {
            text: {
              content: eventId, // The event ID from Google Calendar
            },
          },
        ],
      },
    },
  };

  Logger.log(`Payload to Notion: ${JSON.stringify(payload)}`); // Log the payload

  try {
    const response = UrlFetchApp.fetch(notionUpdateUrl, {
      method: "patch",
      contentType: "application/json",
      headers: headers,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    Logger.log(`Response Code: ${responseCode}`);
    Logger.log(`Response Body: ${responseBody}`);

    if (responseCode !== 200) {
      throw new Error(`Failed to update Notion Event ID. Response: ${responseBody}`);
    }
  } catch (err) {
    Logger.log(`Error updating Notion Event ID: ${err.message}`);
  }
}

// Remove duplicate Google Calendar events by name
function removeDuplicateEvents(calendarId, eventName, startDate, endDate) {
  try {
    const options = {
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      showDeleted: false,
      singleEvents: true,
      orderBy: 'startTime',
    };

    const response = Calendar.Events.list(calendarId, options);
    const events = response.items || [];

    // Filter events by name
    const duplicateEvents = events.filter(event => event.summary === eventName);

    if (duplicateEvents.length <= 1) {
      Logger.log(`No duplicates found for event name: ${eventName}`);
      return;
    }

    Logger.log(`Found ${duplicateEvents.length} duplicate events for name: ${eventName}`);

    // Sort events by start time to keep the first one
    duplicateEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

    // Keep the first event and delete the rest
    const eventToKeep = duplicateEvents.shift();
    Logger.log(`Keeping event: ${eventToKeep.id}`);

    duplicateEvents.forEach(event => {
      try {
        Calendar.Events.delete(calendarId, event.id);
        Logger.log(`Deleted duplicate event: ${event.id}`);
      } catch (error) {
        Logger.log(`Failed to delete event: ${event.id}, Error: ${error.message}`);
      }
    });

    Logger.log(`Completed removing duplicates for event name: ${eventName}`);
  } catch (error) {
    Logger.log(`Error during duplicate removal: ${error.message}`);
  }
}

// Remove duplicate Google Calendar events automatically by finding duplicate names
function removeDuplicateEventsAutomatically(calendarId, startDate, endDate) {
  try {
    // const options = {
    //   timeMin: new Date(startDate).toISOString(),
    //   timeMax: new Date(endDate).toISOString(),
    //   showDeleted: false,
    //   singleEvents: true,
    //   orderBy: 'startTime',
    // };
    const options = {
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      showDeleted: false,
      singleEvents: true,
      orderBy: 'startTime',
      alwaysIncludeStartDateTime: true // Ensure time-based events are included
    };

    const response = Calendar.Events.list(calendarId, options);
    const events = response.items || [];

    // Group events by name
    const eventsByName = events.reduce((acc, event) => {
      if (!event.summary) return acc;
      acc[event.summary] = acc[event.summary] || [];
      acc[event.summary].push(event);
      return acc;
    }, {});

    // Process each group of events
    Object.keys(eventsByName).forEach(eventName => {
      const duplicateEvents = eventsByName[eventName];

      if (duplicateEvents.length <= 1) {
        Logger.log(`No duplicates found for event name: ${eventName}`);
        return;
      }

      Logger.log(`Found ${duplicateEvents.length} duplicate events for name: ${eventName}`);

      // Sort events by start time to keep the first one
      duplicateEvents.sort((a, b) => new Date(a.start.dateTime || a.start.date) - new Date(b.start.dateTime || b.start.date));

      // Keep the first event and delete the rest
      const eventToKeep = duplicateEvents.shift();
      Logger.log(`Keeping event: ${eventToKeep.id}`);

      duplicateEvents.forEach(event => {
        try {
          // Calendar.Events.delete(calendarId, event.id);
          Calendar.Events.remove(calendarId, event.id);
          Logger.log(`Deleted duplicate event: ${event.id}`);
        } catch (error) {
          Logger.log(`Failed to delete event: ${event.id}, Error: ${error.message}`);
        }
      });
    });

    Logger.log(`Completed removing duplicates for calendar ID: ${calendarId}`);
  } catch (error) {
    Logger.log(`Error during duplicate removal: ${error.message}`);
  }
}

// Example usage
function removeDuplicatesExample() {
  const calendarId = 'primary'; // Replace with your calendar ID
  const startDate = '2024-11-17'; // Replace with the desired start date
  const endDate = '2025-01-04'; // Replace with the desired end date


  removeDuplicateEventsAutomatically(calendarId, startDate, endDate);
}

// Function to remove Notion tasks without a corresponding Google Calendar event
function removeMismatchedNotionTasks(calendarId, startDate, endDate, notionTasks, notionHeaders) {
  try {
    // Define options for fetching events
    const options = {
      timeMin: new Date(startDate).toISOString(),
      timeMax: new Date(endDate).toISOString(),
      showDeleted: false,
      singleEvents: true,
      orderBy: 'startTime',
    };

    // Fetch events from the calendar
    const events = Calendar.Events.list(calendarId, options).items || [];
    Logger.log(`Fetched ${events.length} events from calendar ${calendarId}`);

    // Extract Event IDs from Google Calendar events
    const googleEventIds = new Set(events.map(event => event.id));

    // Iterate through Notion tasks and remove tasks not matching Google Calendar events
    notionTasks.forEach((task) => {
      if (task.eventId && !googleEventIds.has(task.eventId)) { // Event ID가 Google Calendar에 없는 경우
        try {
          Logger.log(`Deleting Notion Task for missing Google Calendar Event ID: ${task.eventId} ${task.name}`);
          deleteNotionTaskWithBackup(task.id, task, null, notionHeaders); // Notion 작업 삭제
        } catch (error) {
          Logger.log(`Failed to delete Notion Task ID: ${task.id}, Error: ${error.message}`);
        }
      }else{
        Logger.log(`Notion Task : ${task.eventId} ${task.name}`);
      }
    });

    Logger.log('Mismatched Notion task removal completed.');
  } catch (error) {
    Logger.log(`Error while removing mismatched Notion tasks: ${error.message}`);
  }
}

// Example usage of removeMismatchedNotionTasks
function exampleRemoveMismatchedTasks() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID
  const calendarId = 'primary'; // Google Calendar ID
  const backupFolderId = scriptProperties.getProperty('backupFolderId'); // Backup folder ID for deleted tasks

  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };
  Logger.log(`${notionHeaders} ${databaseId}`);
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30); // 30일 전부터
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30); // 30일 후까지

  // Fetch Notion tasks (example function, replace with actual implementation)
  const notionTasks = fetchNotionTasks(notionHeaders, databaseId);

  // Remove mismatched tasks
  removeMismatchedNotionTasks(calendarId, startDate.toISOString(), endDate.toISOString(), notionTasks, notionHeaders);
}

function fetchNotionTasks(notionHeaders, databaseId) {
  try {
    const notionUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
    const payload = {
      sorts: [
        {
          timestamp: "last_edited_time",
          direction: "descending",
        },
      ],
      // filter: {
      //   property: "archived",
      //   checkbox: {
      //     equals: false, // Only fetch non-archived tasks
      //   },
      // },
    };

    const response = UrlFetchApp.fetch(notionUrl, {
      method: "post",
      contentType: "application/json",
      headers: notionHeaders,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const notionData = JSON.parse(response.getContentText());

    if (!notionData || !notionData.results) {
      throw new Error("Invalid or empty response from Notion API.");
    }

    // Map tasks to include only relevant properties
    return notionData.results.map((task) => {
      const properties = task.properties;
      return {
        id: task.id,
        name: properties["Task name"]?.title?.[0]?.plain_text || '(No Title)',
        eventId: properties["Event ID"]?.rich_text?.[0]?.plain_text || null,
        // calendarId: properties["Calendar ID"]?.rich_text?.[0]?.plain_text || 'primary',
        calendarId: properties?.["Calendar ID"]?.select?.name || 'primary', // Google Calendar ID (select 타입)
        lastSync: properties["Last Sync"]?.date?.start || null,
      };
    });
  } catch (error) {
    Logger.log(`Error fetching Notion tasks: ${error.message}`);
    return [];
  }
}

// nortion
function fetchAllNotionTasks() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID

  // Notion API 헤더 설정
  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  // Notion API 요청 URL
  const notionUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;

  try {
    // API 호출
    const response = UrlFetchApp.fetch(notionUrl, {
      method: "post",
      contentType: "application/json",
      headers: notionHeaders,
      muteHttpExceptions: true, // 오류 발생 시 코드 중단 방지
    });

    // 응답 데이터 파싱
    const notionData = JSON.parse(response.getContentText());

    // 응답 데이터 검증
    if (!notionData || !notionData.results) {
      throw new Error("Invalid or empty response from Notion API.");
    }

    // 작업(Task) 목록 추출 및 로그 출력
    notionData.results.forEach((task) => {
      const properties = task.properties;
      Logger.log(properties);
      Logger.log(`Task ID: ${task.id}`);
      Logger.log(`Task Name: ${properties["Task name"]?.title?.[0]?.plain_text || '(Untitled)'}`);
      Logger.log(`Last Edited Time: ${task.last_edited_time}`);
      Logger.log(`${task.properties["Location"].rich_text[0].plain_text}`);
      Logger.log(`Archived: ${properties.archived?.checkbox || false}`);
      Logger.log(`-------------------------------`);
    });

    Logger.log(`Total tasks fetched: ${notionData.results.length}`);
  } catch (error) {
    Logger.log(`Error fetching Notion tasks: ${error.message}`);
  }
}


function fetchFilteredAndSortedNotionTasks() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const notionApiKey = scriptProperties.getProperty('notionApiKey'); // Notion API 키
  const databaseId = scriptProperties.getProperty('notionDatabaseId'); // Notion 데이터베이스 ID

  const notionHeaders = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  const notionUrl = `https://api.notion.com/v1/databases/${databaseId}/query`;
  Logger.log(notionUrl);
  
  const payload = {
    // 필터 조건 설정
    filter: {
      and: [
        {
          property: "Status", // 상태 속성
          status: {
            equals: "In Progress", // "In Progress" 상태인 작업만 필터링
          },
        },
        {
          property: "Due", // 마감일 속성
          date: {
            on_or_after: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString(),//new Date().toISOString(), // 오늘 이후 마감일인 작업만 필터링
          },
        },
      ],
    },
    // 정렬 조건 설정
    sorts: [
      {
        property: "Due", // 마감일 기준
        direction: "ascending", // 오름차순 정렬
      },
      {
        timestamp: "last_edited_time", // 마지막 편집 시간 기준
        direction: "descending", // 내림차순 정렬
      },
    ],
  };
  Logger.log(payload);
  
  try {
    const response = UrlFetchApp.fetch(notionUrl, {
      method: "post",
      contentType: "application/json",
      headers: notionHeaders,
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    Logger.log(response);

    const notionData = JSON.parse(response.getContentText());

    if (!notionData || !notionData.results) {
      throw new Error("Invalid or empty response from Notion API.");
    }

    Logger.log(`Filtered and Sorted Tasks: ${notionData.results.length}`);

    // 작업(Task) 목록 출력
    notionData.results.forEach((task) => {
      const properties = task.properties;
      Logger.log(`Task ID: ${task.id}`);
      Logger.log(`Task Name: ${properties["Task name"]?.title?.[0]?.plain_text || '(No Title)'}`);
      Logger.log(`Status: ${properties.Status?.select?.name || 'No Status'}`);
      Logger.log(`Due Date: ${properties.Due?.date?.start || 'No Due Date'}`);
      Logger.log(`Last Edited: ${task.last_edited_time}`);
      Logger.log(`-------------------------------`);
    });
  } catch (error) {
    Logger.log(`Error fetching filtered and sorted Notion tasks: ${error.message}`);
  }
}

function mainGoogleCalendarToGoogleSheet() {
  const userProperties = PropertiesService.getScriptProperties();
  const sheetId = userProperties.getProperty('sheetId');

  if (!sheetId) {
    console.error('Sheet ID is not set in user properties.');
    return;
  }

  initializeSheet(); // 시트 초기화
  syncCalendarEvents(); // 캘린더 이벤트 동기화
}
function testNotionAPI() {
  const userProperties = PropertiesService.getScriptProperties();
  const notionApiKey = userProperties.getProperty('notionApiKey');
  const databaseId = userProperties.getProperty('notionDatabaseId');

  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  console.log(url);
  const headers = {
    "Authorization": `Bearer ${notionApiKey}`,
    "Content-Type": "application/json",
    "Notion-Version": "2022-06-28",
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: headers,
    payload: JSON.stringify({}),
    muteHttpExceptions: true, // 에러 전체 확인
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    Logger.log(response.getContentText()); // 응답 출력
  } catch (err) {
    Logger.log(`Error: ${err.message}`);
  }
}


// google sheet
function syncCalendarEvents() {
  const calendarId = 'primary'; // 기본 캘린더
  const userProperties = PropertiesService.getScriptProperties();
  const sheetId = userProperties.getProperty('sheetId'); // 구글 시트 ID를 속성값에서 읽기
  const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet(); // 시트 ID로 시트 접근

  let syncToken = userProperties.getProperty('syncToken'); // 기존 syncToken 불러오기

  try {
    let optionalArgs = syncToken
      ? {
          syncToken: syncToken,
          maxResults: 100, // 동기화 시 최대 100개 읽기
        }
      : {
          maxResults: 100, // 최초 동기화 시 최대 100개 읽기
          timeMin: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString(),
          timeMax: new Date(new Date().setDate(new Date().getDate() + 60)).toISOString(),
          singleEvents: true,
          orderBy: 'startTime',
        };

    let pageToken;
    do {
      if (pageToken) {
        optionalArgs.pageToken = pageToken; // 페이지 토큰 추가
      }

      const response = Calendar.Events.list(calendarId, optionalArgs);

      // syncToken 유효하지 않을 경우(예: 오래된 토큰) 전체 동기화 수행
      if (response.error && response.error.code === 410) {
        console.log('Sync token expired. Performing full sync.');
        userProperties.deleteProperty('syncToken');
        return syncCalendarEvents(); // 재귀 호출로 전체 동기화 수행
      }

      // 새로운 이벤트 처리
      const events = response.items;
      if (events && events.length > 0) {
        const existingEventIds = getExistingEventIds(sheet);

        for (const event of events) {
          const eventId = event.id;

          // 중복 확인
          if (existingEventIds.has(eventId)) {
            continue;
          }

          const calendarName = "Primary Calendar"; // 캘린더 이름
          const startTime = event.start.dateTime || event.start.date;
          const endTime = event.end.dateTime || event.end.date;
          const summary = event.summary || '(제목 없음)';
          const description = event.description || '(설명 없음)';
          const creator = event.creator ? event.creator.email : '(작성자 정보 없음)';

          // 반복 이벤트 제한: 향후 60일까지 처리
          if (event.recurringEventId && new Date(startTime) > new Date(new Date().setDate(new Date().getDate() + 60))) {
            continue;
          }

          // 시트에 작성
          sheet.appendRow([calendarName, startTime, endTime, summary, description, creator, eventId]);
        }
      } else {
        console.log('동기화할 새 이벤트가 없습니다.');
      }

      pageToken = response.nextPageToken; // 다음 페이지 토큰 업데이트

      // 새로운 syncToken 저장
      if (response.nextSyncToken) {
        userProperties.setProperty('syncToken', response.nextSyncToken);
      }

    } while (pageToken); // 다음 페이지가 있으면 계속 처리

  } catch (err) {
    console.error(`Error during calendar sync: ${err.message}`);
  }
}

function getExistingEventIds(sheet) {
  const data = sheet.getDataRange().getValues();
  const eventIds = new Set();

  for (let i = 1; i < data.length; i++) { // 첫 번째 행은 헤더로 가정
    eventIds.add(data[i][6]); // 이벤트 ID는 7번째 열 (0 기반 인덱스 6)
  }

  return eventIds;
}

function initializeSheet() {
  const userProperties = PropertiesService.getScriptProperties();
  const sheetId = userProperties.getProperty('sheetId'); // 구글 시트 ID를 속성값에서 읽기
  const sheet = SpreadsheetApp.openById(sheetId).getActiveSheet(); // 시트 ID로 시트 접근
  const headers = ["캘린더 이름", "시작 시간", "종료 시간", "제목", "설명", "작성자", "이벤트 ID"];
  sheet.clear();
  sheet.appendRow(headers);
}
// google sheet
