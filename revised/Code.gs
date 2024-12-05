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
        calendarId: properties?.["Calendar ID"]?.rich_text?.[0]?.plain_text || null,
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
      const calendarEvents = Calendar.Events.list(calendarId, getOptions()).items || [];
      const existingEventIds = getExistingGcalEventIds(calendarId);

      tasks.forEach((task) => {
        Logger.log(`Processing Task: ${JSON.stringify(task)}`);

        // Task의 Last Sync와 Google Calendar의 업데이트된 시간 비교 전 로그
        Logger.log(`Task Last Sync: ${task.lastSync}`);
        const event = calendarEvents.find(e => e.id === task.eventId);
        Logger.log(`Event Updated Time: ${event?.updated || 'Not Found'}`);

        // if (task.lastSync && isSyncTimeEqual(task.lastSync, calendarEvents, task.eventId)) {
        //   Logger.log(`Skipping task ${task.name} as it is already up-to-date.`);
        //   return;
        // }

        // if (shouldSkipTask(task.lastSync, task.lastEditedTime, task.name)) {
        //   return;
        // }

        if (shouldSkipTask(task.lastSync, task.lastEditedTime, event?.etag, task.etag)) {
          Logger.log(`Skipping task ${task.name} as it is already up-to-date.`);
          return;
        }

        if (task.eventId && existingEventIds.has(task.eventId)) {
          const event = {
            summary: task.name,
            description: task.description,
            location: task.location,
            start: task.start,
            end: task.end,
          };

          const updatedEvent = Calendar.Events.update(event, calendarId, task.eventId);
          const now = new Date().toISOString();
          updateNotionLastSync(task.id, now, notionHeaders);
          updateNotionEventId(task.id, updatedEvent.id, notionHeaders);
          updateNotionEtag(task.id, updatedEvent.etag, notionHeaders);
          Logger.log(`Updated event in calendar ${calendarId}: ${updatedEvent.id}`);
        } else {
          const event = {
            summary: task.name,
            description: task.description,
            location: task.location,
            start: task.start,
            end: task.end,
          };
          const createdEvent = Calendar.Events.insert(event, calendarId);
          task.eventId = createdEvent.id;
          task.calendarId = calendarId;
          const now = new Date().toISOString();
          updateNotionLastSync(task.id, now, notionHeaders);
          updateNotionEventId(task.id, createdEvent.id, notionHeaders);
          updateNotionEtag(task.id, createdEvent.etag, notionHeaders);
          Logger.log(`Inserted new event in calendar ${calendarId}: ${createdEvent.id}`);
        }
      });
    });

    // 동기화 완료 시간 업데이트
    // scriptProperties.setProperty('lastSyncTime', new Date().toISOString());
  } catch (err) {
    console.error(`Error during sync: ${err.message}`);
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
  const calendarEvents = Calendar.Events.list(calendarId,getOptions()).items || [];
  Logger.log(`Calendar Events: ${JSON.stringify(calendarEvents)}`);

  // Safely map `id` values
  const existingEventIds = new Set(
    calendarEvents
      .map((event) => {
        if (event.id) {
          Logger.log(`Found Event ID: ${event.id}`);
          return event.id;
        } else {
          Logger.log(`Event without ID: ${JSON.stringify(event)}`);
          return null;
        }
      })
      .filter(Boolean) // Remove null or undefined IDs
  );

  Logger.log(`Existing Event IDs: ${[...existingEventIds]}`);
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
      const existingCalendarEventIds = new Set(calendarEvents.map((event) => event.id).filter(Boolean));

      // 새롭게 추가된 Notion 작업 처리
      handleNewNotionTasks(notionTasks, calendarId, notionHeaders);
      // Google Calendar에 없는 Notion 작업 삭제 처리
      handleNotionTaskDeletion(notionTasks, existingCalendarEventIds, calendarOptions, backupFolderId, notionHeaders);
      // Notion에 없는 Google Calendar 이벤트 삭제 처리
      handleCalendarEventDeletion(calendarEvents, notionTasks, calendarOptions, backupFolderId, calendarId);

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
    console.error(`Error during sync: ${err.message}`);
  }
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
    Calendar.Events.delete(calendarId, eventId);
    Logger.log(`Successfully deleted Google Calendar Event ID: ${eventId}`);
  } catch (err) {
    Logger.log(`Failed to delete Google Calendar Event ID: ${eventId}: ${err.message}`);
  }
}

function saveToDriveAsJson(filename, data, folderId) {
  const folder = DriveApp.getFolderById(folderId);
  const jsonFile = folder.createFile(filename, JSON.stringify(data, null, 2), MimeType.JSON);
  Logger.log(`Saved backup to Google Drive: ${jsonFile.getUrl()}`);
}
function deleteGoogleCalendarEventWithBackup(calendarId, eventId, event, folderId) {
  try {
    saveToDriveAsJson(`calendar_event_${eventId}.json`, event, folderId);
    Calendar.Events.delete(calendarId, eventId);
    Logger.log(`Successfully deleted Google Calendar Event ID: ${eventId}`);
  } catch (err) {
    Logger.log(`Failed to delete Google Calendar Event ID: ${eventId}: ${err.message}`);
  }
}
function deleteNotionTaskWithBackup(pageId, task, folderId, headers) {
  try {
    saveToDriveAsJson(`notion_task_${pageId}.json`, task, folderId);
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
function handleNotionTaskDeletion(notionTasks, existingCalendarEventIds, calendarOptions, backupFolderId, notionHeaders) {
  notionTasks.forEach((task) => {
    if (task.eventId && !existingCalendarEventIds.has(task.eventId)) { // 이벤트 ID가 Google Calendar에 없는 경우
      if (isWithinSyncRange(task.lastSync, calendarOptions.timeMin, calendarOptions.timeMax)) { // 동기화 범위 내인지 확인
        Logger.log(`Backing up and deleting Notion Task for missing Calendar Event ID: ${task.eventId}`);
        saveToDriveAsJson(`notion_task_${task.id}.json`, task, backupFolderId); // 백업
        deleteNotionTaskWithBackup(task.id, task, backupFolderId, notionHeaders); // Notion 작업 삭제
      } else {
        Logger.log(`Notion Task ${task.id} is out of sync range, skipping delete.`); // 동기화 범위 밖인 경우 건너뜀
      }
    }
  });
}

// Notion에 없는 Google Calendar 이벤트 삭제 처리
function handleCalendarEventDeletion(calendarEvents, notionTasks, calendarOptions, backupFolderId, calendarId) {
  calendarEvents.forEach((event) => {
    const eventId = event.id;

    if (!notionTasks.find((task) => task.eventId === eventId)) { // 이벤트 ID가 Notion 작업에 없는 경우
      if (isWithinSyncRange(event.start?.dateTime || event.start?.date, calendarOptions.timeMin, calendarOptions.timeMax)) { // 동기화 범위 내인지 확인
        Logger.log(`Backing up and deleting Calendar Event for missing Notion Task: ${eventId}`);
        saveToDriveAsJson(`calendar_event_${eventId}.json`, event, backupFolderId); // 백업
        deleteGoogleCalendarEventWithBackup(calendarId, eventId, event, backupFolderId); // Google Calendar 이벤트 삭제
      } else {
        Logger.log(`Calendar Event ${eventId} is out of sync range, skipping delete.`); // 동기화 범위 밖인 경우 건너뜀
      }
    }
  });
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
