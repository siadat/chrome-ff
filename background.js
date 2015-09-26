var FF_MAX_SUGGESTIONS = 10;
var FF_MAX_MATCHLENGTH = 1000;
var FF_DEBUGGING = false;
var FF_INCLUDE_HISTORY = false;
var ffHistory = [];

function ffEscapeRegExp(str) {
  return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function ffActivateTag(tabId, windowId) {
  if(tabId) {
    chrome.tabs.update(tabId, {active: true});
  }
  if(windowId) {
    chrome.windows.update(windowId, {focused: true});
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

function ffHighlightText(text, words_exact_hl, words_fuzzy) {
  words_exact_hl.forEach(function(word) {
    if(text.match(word)) {
      text = text.replace(word, "\0$1\1")
    }
  });
  words_fuzzy.forEach(function(word) {
    if(text.match(word)) {
      text = text.replace(word, function(m) {
        return "\0" + m + "\1";
      });
    }
  });
  return ffEscapeHtml(text).replace(new RegExp("\0", "g"), "<match>")
                           .replace(new RegExp("\1", "g"), "</match>");
}

function ffCalculateScoreWords(tab, words_exact, words_fuzzy) {
  var score = 0;
  var hostname = ffGetHostname(tab.url);

  var found_words = words_exact.map(function() { return false; })

  words_fuzzy.forEach(function(word, i) {
    if(tab.title.match(word)) { score += 20; found_words[i] = true; }
    if(tab.url.match(word)) { score += 20; found_words[i] = true; }
    if(hostname.match(word)) { score += 20; found_words[i] = true; }
  });

  words_exact.forEach(function(word, i) {
    if(found_words[i]) { return; }
    if(tab.title.match(word)) { score += 100; found_words[i] = true; }
    if(tab.url.match(word)) { score += 100; found_words[i] = true; }
    if(hostname.match(word)) { score += 100; found_words[i] = true; }
  });

  if(found_words.filter(function(x) { return x; }).length !== words_exact.length) { score = 0; }
  if(score > 0 && tab.pinned) { score += 1000; }

  if(FF_DEBUGGING && score > 0) { console.debug("tab", tab.title); }
  return score;
}

function ffSearchFor(text, callback) {
  text = text.trim();

  var words_exact = text.split(/\s+/).map(function(word) {
    return new RegExp(ffEscapeRegExp(word), 'i');
  });

  var words_exact_hl = text.split(/\s+/).map(function(word) {
    return new RegExp("(" + ffEscapeRegExp(word) + ")", 'ig');
  });

  var words_fuzzy = text.split(/\s+/).map(function(word) {
    return new RegExp(word.split('').map(function(ch) { return ffEscapeRegExp(ch); }).join('.*?'), 'i');
  });

  if(FF_INCLUDE_HISTORY) {
    chrome.history.search({text: ""}, function(array_of_history_items) {
      callback(
        array_of_history_items.
        map(function(tab) {
          return {content: JSON.stringify({url: tab.url}), description: "history " + ffEscapeHtml(tab.url)}
        })
      );
    });
  }

  chrome.tabs.query({}, function(array_of_tabs) {
    callback(
        array_of_tabs.
        map(function(tab) { tab.score = ffCalculateScoreWords(tab, words_exact, words_fuzzy); return tab; }).
        filter(function(tab) { return tab.score >= 10; }).
        sort(function(tab1, tab2) {
          if(tab1.score < tab2.score) return 1;
          if(tab1.score > tab2.score) return -1;
          return 0;
        }).
        slice(0, FF_MAX_SUGGESTIONS).
        map(function(tab) {
          var content = JSON.stringify({tabId: tab.id, windowId: tab.windowId});
          var desc = ffHighlightText(tab.title, words_exact_hl, words_fuzzy) + " <url>" +  ffHighlightText(ffGetHostname(tab.url), words_exact_hl, words_fuzzy) + "</url>";

          if(FF_DEBUGGING) {
            desc = "score:" + tab.score + " - " + desc;
          }

          if(tab.status !== "complete") {
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

          return {content: content, description: desc};
      })
    );
  });
}

chrome.omnibox.onInputChanged.addListener(
  function(text, suggest) {
    ffSearchFor(text, suggest);
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
        ffSearchFor(text, function(suggestions) {
          if(suggestions.length === 0) { return; }
          var selected = JSON.parse(suggestions[0].content);
          ffHistory.push(selected);
          ffActivateTag(selected.tabId, selected.windowId)
        });
        return;
      }
    }

    ffHistory.push(selected);
    ffActivateTag(selected.tabId, selected.windowId)
  }
);
