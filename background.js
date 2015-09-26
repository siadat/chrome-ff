// This event is fired each time the user updates the text in the omnibox,
// as long as the extension's keyword mode is still active.
var FF_MAX_SUGGESTIONS = 20;
var FF_MAX_MATCHLENGTH = 1000;
var FF_DEBUGGING = false;
var FF_HISTORY = [];

function ffGetHostname(url) {
  var a  = document.createElement('a');
  a.href = url;
  return a.hostname;
}

function ffSearchFor(text, callback) {
  chrome.tabs.query({}, function(array_of_tabs) {
    var fuzzy_query = new RegExp(text.split('').join('.*?'), 'i');
    var exact_query = new RegExp(text, 'i');
    var exact_query_hl = new RegExp("(" + text + ")", 'ig');
    callback(
        array_of_tabs.
        map(function(tab) {

          switch (true) {
          case !!tab.title.match(exact_query):
            tab.score = 40;
            tab.score += 1 - 1.0 * exact_query.exec(tab.title).index / FF_MAX_MATCHLENGTH;
            tab.title = ffEscapeHtml(tab.title);
            tab.title = tab.title.replace(exact_query_hl, "<match>$1</match>")
            break;
          case !!tab.url.match(exact_query):
            tab.score = 40;
            tab.score += 1 - 1.0 * exact_query.exec(tab.url).index / FF_MAX_MATCHLENGTH;
            tab.title = ffEscapeHtml(tab.title);
            break;
          case !!tab.title.match(fuzzy_query):
            tab.score = 20;
            tab.score += 1 - 1.0 * tab.title.match(fuzzy_query)[0].length / FF_MAX_MATCHLENGTH;
            tab.title = ffEscapeHtml(tab.title);
            tab.title = tab.title.replace(fuzzy_query, function(m) { return "<match>" + m + "</match>"; })
            break;
          case !!tab.url.match(fuzzy_query):
            tab.score = 20;
            tab.score += 1 - 1.0 * tab.url.match(fuzzy_query)[0].length / FF_MAX_MATCHLENGTH;
            tab.title = ffEscapeHtml(tab.title);
            break;
          default:
            tab.score = 0;
          }

          if(tab.score > 0) {
            var hostname = ffGetHostname(tab.url);
            switch (true) {
              case !!hostname.match(exact_query):
                tab.hostname = hostname.replace(exact_query_hl, "<match>$1</match>");
                tab.score += 200;
                break;
              case !!hostname.match(fuzzy_query):
                tab.hostname = hostname.replace(fuzzy_query, function(m) { return "<match>" + m + "</match>"; });
                tab.score += 100;
                break;
            }
          }

          if(FF_DEBUGGING && tab.score > 0) { console.debug("tab", tab.title); }

          if(tab.pinned) { tab.score += 1; }

          return tab;
        }).
        filter(function(tab) {
          return tab.score >= 10;
        }).
        sort(function(tab1, tab2) {
          if(tab1.score < tab2.score) return 1;
          if(tab1.score > tab2.score) return -1;
          return 0;
        }).
        slice(0, FF_MAX_SUGGESTIONS).
        map(function(tab) {

          var content = JSON.stringify({tabId: tab.id, windowId: tab.windowId});
          if(!tab.hostname) { tab.hostname = ffGetHostname(tab.url)}
          tab.title = tab.title.replace(/\s+/, ' ');
          var desc = tab.title + " <url>" + tab.hostname + "</url>";
          if(FF_DEBUGGING) { desc = "score:" + tab.score + " - " + desc; }

          if(tab.status !== "complete") desc = "[" + tab.status + "] " + desc;
          if(tab.incognito) desc = "<url>[Incognito]</url> " + desc;
          if(tab.pinned)    desc = "<url>[Pinned]</url> " + desc;
          if(tab.audible)   desc = "<url>[Audible]</url> " + desc;

          return {content: content, description: desc};
      })
    );
  });
}

chrome.omnibox.onInputChanged.addListener(
  function(text, suggest) { ffSearchFor(text, suggest); }
);

function ffEscapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;")
               .replace(/'/g, "&#039;");
}

function ffActivateTag(tabId, windowId) {
  if(tabId) {
    chrome.tabs.update(tabId, {active: true});
  }
  if(windowId) {
    chrome.windows.update(windowId, {focused: true});
  }
}

chrome.omnibox.onInputEntered.addListener(
  function(text) {
    if(FF_DEBUGGING) {
      console.debug("entered:", text);
      console.debug("history:", FF_HISTORY);
    }

    var selected = {};

    if(text.length === 0) {
      if(FF_HISTORY.length >= 2) {
        selected = FF_HISTORY[FF_HISTORY.length - 2];
      } else {
        return;
      }
    } else {
      try {
        selected = JSON.parse(text);
      } catch(e) {
        // User probably typed something but selected the first default option,
        // i.e., "Run ff command: query"
        ffSearchFor(text, function(suggestions) {
          if(suggestions.length === 0) { return; }
          var selected = JSON.parse(suggestions[0].content);
          FF_HISTORY.push(selected);
          ffActivateTag(selected.tabId, selected.windowId)
        });
        return;
      }
    }

    FF_HISTORY.push(selected);
    ffActivateTag(selected.tabId, selected.windowId)
  }
);
