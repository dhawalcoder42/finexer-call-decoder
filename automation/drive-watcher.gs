/**
 * Finexer Call Decoder - Google Drive watcher
 * -------------------------------------------
 * Watches the "Demo Calls" folder in Google Drive. Every time Otter drops a
 * new transcript there, this pushes it straight into the Call Decoder, which
 * queues it and decodes it on its own. Nobody has to open the app.
 *
 * SETUP (once, about three minutes)
 *   1. Go to script.google.com and click New project.
 *   2. Delete whatever is in the editor and paste this whole file in.
 *   3. Rename the project to "Finexer Call Decoder watcher" (top left).
 *   4. Click Save.
 *   5. Click Run and pick the function "setup". Google asks for permission
 *      the first time: choose your account, click Advanced, then
 *      "Go to ... (unsafe)", then Allow. That screen is normal for your own
 *      scripts.
 *   6. Check the Execution log. It should say the watcher is installed.
 *
 * After that it runs by itself every minute. Nothing else to do.
 *
 * To see what it is doing: script.google.com, open the project, click
 * Executions in the left sidebar.
 *
 * To stop it: run the function "removeTrigger".
 */

/* ----------------------------- settings ----------------------------- */

/** Drive folder that Otter writes transcripts into ("Demo Calls"). */
var FOLDER_ID = '1l414Oo93KskyESUVji8WjxFL67nR3Rof';

/** The Call Decoder ingest endpoint. */
var INGEST_URL = 'https://finexercalldecode.netlify.app/.netlify/functions/ingest';

/** Must match the INGEST_KEY environment variable on Netlify.
 *  Paste the real value here in the Apps Script editor. It is deliberately
 *  left blank in the repository so the secret is not stored in git. */
var INGEST_KEY = 'PASTE_YOUR_INGEST_KEY_HERE';

/** How often to look for new files, in minutes. 1 is the Google minimum. */
var EVERY_MINUTES = 1;

/** Ignore files older than this on the very first run, in days. Stops a
 *  brand new watcher from re-uploading months of old transcripts. */
var FIRST_RUN_LOOKBACK_DAYS = 7;

/* --------------------------- main watcher --------------------------- */

/** Apps Script kills a run at six minutes. Stop before that and save, so a
 *  big folder is worked through across runs instead of restarting forever. */
var TIME_BUDGET_MS = 4.5 * 60 * 1000;

/** Write the seen list to disk every this many files, so a run that is cut
 *  short still keeps its progress. */
var SAVE_EVERY = 20;

function checkForNewTranscripts() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var seen = JSON.parse(props.getProperty('seenFileIds') || '[]');
  var seenSet = {};
  for (var s = 0; s < seen.length; s++) seenSet[seen[s]] = true;

  var firstRun = props.getProperty('initialised') !== 'yes';
  var cutoff = new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var files = folder.getFiles();
  var sent = 0;
  var skipped = 0;
  var failed = 0;
  var sinceSave = 0;
  var ranOutOfTime = false;

  function persist(markInitialised) {
    if (seen.length > 2000) seen = seen.slice(seen.length - 2000);
    props.setProperty('seenFileIds', JSON.stringify(seen));
    if (markInitialised) props.setProperty('initialised', 'yes');
    sinceSave = 0;
  }

  while (files.hasNext()) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      ranOutOfTime = true;
      break;
    }

    var file = files.next();
    var id = file.getId();
    var name = file.getName();

    if (seenSet[id]) continue;

    // Transcripts only.
    var type = file.getMimeType();
    var isText = type === 'text/plain' || /\.txt$/i.test(name);
    var isGoogleDoc = type === 'application/vnd.google-apps.document';
    if (!isText && !isGoogleDoc) continue;

    // On the very first run, only take recent files.
    if (firstRun && file.getDateCreated() < cutoff) {
      seen.push(id);
      seenSet[id] = true;
      skipped++;
      continue;
    }

    var transcript;
    try {
      transcript = isGoogleDoc
        ? DocumentApp.openById(id).getBody().getText()
        : file.getBlob().getDataAsString('UTF-8');
    } catch (readErr) {
      Logger.log('Could not read "' + name + '": ' + readErr);
      failed++;
      continue;
    }

    if (!transcript || !transcript.trim()) {
      seen.push(id);
      seenSet[id] = true;
      continue;
    }

    var cleanName = name.replace(/\.txt$/i, '') + '.txt';

    try {
      var res = UrlFetchApp.fetch(INGEST_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-ingest-key': INGEST_KEY },
        payload: JSON.stringify({
          filename: cleanName,
          transcript: transcript,
          sourceId: id,
          uploadedBy: 'google-drive',
        }),
        muteHttpExceptions: true,
      });

      var code = res.getResponseCode();
      var text = res.getContentText();

      if (code === 200) {
        var parsed = JSON.parse(text);
        seen.push(id);
        seenSet[id] = true;
        if (parsed.duplicate) {
          Logger.log('Already in the library, skipped: ' + cleanName);
          skipped++;
        } else {
          Logger.log('Sent for decoding: ' + cleanName);
          sent++;
        }
      } else {
        Logger.log('Ingest failed (' + code + ') for ' + cleanName + ': ' + text);
        failed++;
      }
    } catch (sendErr) {
      Logger.log('Ingest threw for ' + cleanName + ': ' + sendErr);
      failed++;
    }

    sinceSave++;
    if (sinceSave >= SAVE_EVERY) persist(false);
  }

  // Only call the first pass finished once the folder was walked to the end,
  // otherwise the lookback window would be skipped on the remaining files.
  persist(!ranOutOfTime);
  props.setProperty('lastRun', new Date().toISOString());

  Logger.log(
    'Done. sent=' + sent + ' skipped=' + skipped + ' failed=' + failed +
      (ranOutOfTime ? ' (time budget reached, continuing next run)' : '')
  );
}

/* ------------------------- setup and teardown ------------------------ */

/** Run this once. Installs the recurring trigger and does a first pass. */
function setup() {
  removeTrigger();
  ScriptApp.newTrigger('checkForNewTranscripts')
    .timeBased()
    .everyMinutes(EVERY_MINUTES)
    .create();
  Logger.log(
    'Watcher installed. It now checks the Demo Calls folder every ' +
      EVERY_MINUTES +
      ' minute(s). Running a first pass now.'
  );
  checkForNewTranscripts();
}

/** Stops the watcher. */
function removeTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'checkForNewTranscripts') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  Logger.log('Watcher stopped.');
}

/** Forget every file the watcher has already sent. The next run will
 *  re-send everything in the folder. The Call Decoder skips duplicates by
 *  filename, so this is safe to run. */
function resetSeenFiles() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty('seenFileIds');
  props.deleteProperty('initialised');
  Logger.log('History cleared. The next run will look at every file again.');
}

/** Quick health check: confirms the folder is reachable and the endpoint
 *  answers. Run this if something looks wrong. */
function testConnection() {
  var folder = DriveApp.getFolderById(FOLDER_ID);
  Logger.log('Folder OK: ' + folder.getName());

  var res = UrlFetchApp.fetch(INGEST_URL, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-key': INGEST_KEY },
    payload: JSON.stringify({ filename: '', transcript: '' }),
    muteHttpExceptions: true,
  });
  var code = res.getResponseCode();
  if (code === 400) {
    Logger.log('Endpoint OK and the key is accepted.');
  } else if (code === 401) {
    Logger.log('The key was rejected. Check INGEST_KEY on Netlify matches this file.');
  } else if (code === 500) {
    Logger.log('Endpoint reached but INGEST_KEY is not set on Netlify yet: ' + res.getContentText());
  } else {
    Logger.log('Unexpected response ' + code + ': ' + res.getContentText());
  }
}
