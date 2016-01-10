var FF_MAX_SUGGESTIONS = 5;
var FF_MAX_MATCHLENGTH = 1000;
var FF_DEBUGGING = false;
var FF_INCLUDE_HISTORY = true;
var FF_MOVE_TAB_TO_FIRST = false;
var FF_MOVE_TAB_TO_FIRST_TO_CURRENT_WINDOW = false;
var ffHistory = [];
var ffCurrentWindowId;
var ffTabsOnStart = [];

function ffEscapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function ffActivateTag(tab) {
  if(tab.url) {
    chrome.tabs.create({url: tab.url});
  }
  if(tab.tabId) {
    chrome.tabs.update(tab.tabId, {active: true});
    if(FF_MOVE_TAB_TO_FIRST) {
      chrome.tabs.move(tab.tabId, {index: 0});
    }
  }
  if(tab.windowId) {
    chrome.windows.update(tab.windowId, {focused: true});
  }
}

function ffEscapeHtml(unsafe) {
  return unsafe.replace(/&/g, "&amp;")
               .replace(/</g, "&lt;")
               .replace(/>/g, "&gt;")
               .replace(/"/g, "&quot;")
               .replace(/'/g, "&#039;");
}

function ffGetHostname(url) {
  var a  = document.createElement('a');
  a.href = url;
  return a.hostname;
}

function ffHighlightText(text, words) {
  words
  .map(function(word) { return ffRegexpExactHl(word); })
  .forEach(function(word) {
    if(text.match(word)) {
      text = text.replace(word, "\0$1\1")
    }
  });

  words
  .map(function(word) { return ffRegexpFuzzy(word); })
  .forEach(function(word) {
    if(text.match(word)) {
      text = text.replace(word, function(m) {
        return "\0" + m + "\1";
      });
    }
  });
  return ffEscapeHtml(text).replace(new RegExp("\0", "g"), "<match>")
                           .replace(new RegExp("\1", "g"), "</match>");
}

function ffCalculateScoreWords(tab, words) {
  var score = 0;
  var hostname = ffGetHostname(tab.url);

  var found_words = words.map(function() { return false; })

  words
  .map(function(word) { return ffRegexpExact(word); })
  .forEach(function(word, i) {
    if(hostname.match(word)) { score += 100; found_words[i] = true; }
    if(tab.title.match(word)) { score += 100; found_words[i] = true; }
    if(tab.url.match(word)) { score += 100; found_words[i] = true; }
  });

  words
  .map(function(word) { return ffRegexpFuzzy(word); })
  .forEach(function(word, i) {
    if(found_words[i]) { return; }
    if(hostname.match(word)) { score += 20; found_words[i] = true; }
    if(tab.title.match(word)) { score += 20; found_words[i] = true; }
    if(tab.url.match(word)) { score += 10; found_words[i] = true; }
  });

  if(tab.visitCount) {
    score += tab.visitCount * 10;
  }

  if(tab.lastVisitTime) {
    score += tab.lastVisitTime / (new Date().getTime());
  }

  if(found_words.filter(function(x) { return x; }).length !== words.length) { score = 0; }
  if(score > 0 && tab.pinned) { score += 1000; }

  if(FF_DEBUGGING && score > 0) { console.debug("matching tab", tab.lastVisitTime && "History" || "Opened", "id:"+ tab.id, "score:"+ score, hostname, tab); }
  return score;
}

function ffRegexpExact(word) {
  return new RegExp(ffEscapeRegExp(word), 'i');
}

function ffRegexpExactHl(word) {
  return new RegExp("(" + ffEscapeRegExp(word) + ")", 'ig');
}

function ffRegexpFuzzy(word) {
  return new RegExp(word.split('').map(function(ch) { return ffEscapeRegExp(ch); }).join('.{0,10}?'), 'i');
}

function ffPrepareTab(tab, words) {
  var content = JSON.stringify({tabId: tab.id, windowId: tab.windowId});
  var desc = ffHighlightText(tab.title, words) + " <url>" +  ffHighlightText(ffGetHostname(tab.url), words) + "</url>";

  if(FF_DEBUGGING) {
    desc = "score:" + tab.score + " - " + desc;
  }

  if(tab.status && tab.status !== "complete") {
    desc = "[" + tab.status + "] " + desc;
  }

  if(tab.incognito) {
    desc = "<url>[Incognito]</url> " + desc;
  }

  if(tab.pinned) {
    desc = "<url>[Pinned]</url> " + desc;
  }

  if(tab.audible) {
    desc = "<url>[Audible]</url> " + desc;
  }

  if(tab.lastVisitTime) {
    content = JSON.stringify({url: tab.url});
    desc = "<url>[History]</url> " + desc;
  }

  return {content: content, description: desc};
}

function ffFilter(tabs, words) {
  return tabs.map(function(tab) { tab.score = ffCalculateScoreWords(tab, words); return tab; })
             .filter(function(tab) { return tab.score >= 10 && tab.title.length > 0; })
             .sort(function(tab1, tab2) {
                if(tab1.score < tab2.score) return 1;
                if(tab1.score > tab2.score) return -1;
                return 0;
              })
             ;
}

function ffConcat(tabs1, tabs2) {
  return tabs1.concat(ffTabsWithout(tabs2, tabs1));
}

function ffTabsWithout(whiteTabs, blackTabs) {
  return whiteTabs.filter(function (whiteTab) {
    return 0 === blackTabs.filter(function (blackTab) { return blackTab.url === whiteTab.url; }).length;
  });
}

function ffReorderTabs(tabs) {
  var windows = {};
  /*
  *  move ones for all (doesn't work correctly):
  *
  *  chrome.tabs.move(tabs.map(function(tab) { return tab.id; }), {index: 0});
  */

  /*
  *  move once for all tabs in each window (doesn't work correctly):
  *
  *  tabs.forEach(function(tab) {
  *    if(!windows[tab.windowId]) {
  *      windows[tab.windowId] = [];
  *    }
  *    windows[tab.windowId].push(tab);
  *  });
  *  for(var windowId in windows) {
  *    console.log("WINDOW", windowId, windows[windowId]);
  *    chrome.tabs.move(windows[windowId].map(function(tab) { return tab.id; }), {index: 0, windowId: parseInt(windowId)});
  *  }
  */

  if(ffTabsOnStart.length === 0) {
    ffTabsOnStart = tabs.map(function(tab) { return {id: tab.id, index: tab.index}; });
  }

  tabs.forEach(function(tab, i) {
    if(FF_MOVE_TAB_TO_FIRST_TO_CURRENT_WINDOW && ffCurrentWindowId) {
      // move one by one to current window
      chrome.tabs.move(tab.id, {index: i, windowId: ffCurrentWindowId});
    } else {
      // move one by one
      if(!windows[tab.windowId]) { windows[tab.windowId] = []; }
      windows[tab.windowId].push(true);
      chrome.tabs.move(tab.id, {index: windows[tab.windowId].length - 1});
    }
  });
}

function ffSearchFor(text) {
  text = text.trim();
  var words = text.split(/\s+/);

  var words_exact_hl = text.split(/\s+/).map(function(word) {
    return ffRegexpExactHl(word);
  });

  return new Promise(function(resolve, reject) {
    chrome.tabs.query({}, function(array_of_tabs) {
      var matching_tabs = ffFilter(array_of_tabs, words);

      if(FF_MOVE_TAB_TO_FIRST) {
        ffReorderTabs(matching_tabs.slice(0, 200));
      }

      matching_tabs = matching_tabs.slice(0, FF_MAX_SUGGESTIONS);
      if(FF_INCLUDE_HISTORY && matching_tabs.length < FF_MAX_SUGGESTIONS) {
        chrome.history.search({text: "", maxResults: 100, startTime: new Date().getTime() - 30 * 24 * 3600 * 1000}, function(array_of_history_items) {
          var matching_histories = ffFilter(array_of_history_items, words);
          resolve(ffConcat(matching_tabs.slice(0, FF_MAX_SUGGESTIONS), matching_histories).map(function(tab) { return ffPrepareTab(tab, words); } ));
        });
        return;
      }
      resolve(matching_tabs.map(function(tab) { return ffPrepareTab(tab, words); }));
    });
  });
}

chrome.windows.onFocusChanged.addListener(
  function(windowId) {
    ffCurrentWindowId = windowId;
  }
);

chrome.omnibox.onInputChanged.addListener(
  function(text, suggest) {
    if(FF_DEBUGGING) { console.debug("input changed:", text); }
    ffSearchFor(text).then(function(suggestions) { suggest(suggestions); });
  }
);

chrome.omnibox.onInputCancelled.addListener(
  // TODO this is called even when user presses UP/Down arrows.
  function() {
    // revert tab order (one by one)
    ffTabsOnStart.sort(function(tab1, tab2) {
      if(tab1.index < tab2.index) return 1;
      if(tab1.index > tab2.index) return -1;
      return 0;
    }).forEach(function(tab, i) {
      chrome.tabs.move(tab.id, {index: tab.index});
    });
    ffTabsOnStart = [];
  }
);

chrome.omnibox.onInputEntered.addListener(
  function(text) {
    if(FF_DEBUGGING) {
      console.debug("entered:", text);
      console.debug("history:", ffHistory);
    }

    var selected = {};

    if(text.length === 0) {
      if(ffHistory.length >= 2) {
        selected = ffHistory[ffHistory.length - 2];
      } else {
        return;
      }
    } else {
      try {
        selected = JSON.parse(text);
      } catch(e) {
        // User probably typed something but selected the first default option,
        // i.e., "Run ff command: query"
        ffSearchFor(text).then(function(suggestions) {
          if(suggestions.length === 0) { return; }
          var selected = JSON.parse(suggestions[0].content);
          ffHistory.push(selected);
          ffActivateTag(selected);
        });
        return;
      }
    }

    ffHistory.push(selected);
    ffActivateTag(selected);
  }
);
