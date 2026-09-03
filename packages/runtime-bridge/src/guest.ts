export const GUEST_BOOTSTRAP: string = `(function() {
  "use strict";

  var idCounter = 0;
  function generateId() {
    idCounter += 1;
    return "g-" + idCounter + "-" + Math.random().toString(36).slice(2, 8);
  }

  var pendingRequests = {};
  var replScope = {};

  function sendMessage(msg) {
    __bridge_send(JSON.stringify(msg));
  }

  function sendResponse(id, result) {
    sendMessage({ id: id, result: result });
  }

  function sendErrorResponse(id, code, message) {
    sendMessage({ id: id, error: { code: code, message: message } });
  }

  function sendNotification(method, params) {
    sendMessage({ method: method, params: params });
  }

  function sendRequest(method, params) {
    return new Promise(function(resolve, reject) {
      var id = generateId();
      pendingRequests[id] = { resolve: resolve, reject: reject };
      sendMessage({ id: id, method: method, params: params });
    });
  }

  // Console interception
  var origConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug
  };

  function safeSerialize(value, seen) {
    if (seen === undefined) seen = [];
    if (value === null || value === undefined) return value;
    if (typeof value === "function") return "[Function: " + (value.name || "anonymous") + "]";
    if (typeof value === "symbol") return value.toString();
    if (typeof value !== "object") return value;
    if (seen.indexOf(value) >= 0) return "[Circular]";
    seen.push(value);
    if (Array.isArray(value)) {
      return value.map(function(v) { return safeSerialize(v, seen); });
    }
    var result = {};
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = safeSerialize(value[keys[i]], seen);
    }
    return result;
  }

  ["log", "warn", "error", "info", "debug"].forEach(function(level) {
    console[level] = function() {
      var args = [];
      for (var i = 0; i < arguments.length; i++) {
        args.push(safeSerialize(arguments[i]));
      }
      sendNotification("console", { level: level, args: args });
      origConsole[level].apply(console, arguments);
    };
  });

  // Base64 helpers
  function uint8ToBase64(data) {
    var binary = "";
    for (var i = 0; i < data.length; i++) {
      binary += String.fromCharCode(data[i]);
    }
    return btoa(binary);
  }

  function base64ToUint8(b64) {
    var binary = atob(b64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // VFS proxy
  globalThis.__vfs = {
    readFile: function(path) {
      return sendRequest("vfs.readFile", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return base64ToUint8(res.result.data);
      });
    },
    writeFile: function(path, data) {
      var b64;
      if (typeof data === "string") {
        var enc = new TextEncoder();
        b64 = uint8ToBase64(enc.encode(data));
      } else {
        b64 = uint8ToBase64(data instanceof Uint8Array ? data : new Uint8Array(data));
      }
      return sendRequest("vfs.writeFile", { path: path, data: b64 }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    readdir: function(path) {
      return sendRequest("vfs.readdir", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return res.result.entries;
      });
    },
    stat: function(path) {
      return sendRequest("vfs.stat", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return res.result;
      });
    },
    lstat: function(path) {
      return sendRequest("vfs.lstat", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return res.result;
      });
    },
    mkdir: function(path, options) {
      return sendRequest("vfs.mkdir", { path: path, recursive: options && options.recursive }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    rmdir: function(path, options) {
      return sendRequest("vfs.rmdir", { path: path, recursive: options && options.recursive }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    unlink: function(path) {
      return sendRequest("vfs.unlink", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    rename: function(oldPath, newPath) {
      return sendRequest("vfs.rename", { oldPath: oldPath, newPath: newPath }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    exists: function(path) {
      return sendRequest("vfs.exists", { path: path }).then(function(res) {
        if (res.error) return false;
        return res.result.exists;
      });
    },
    symlink: function(target, path) {
      return sendRequest("vfs.symlink", { target: target, path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
      });
    },
    readlink: function(path) {
      return sendRequest("vfs.readlink", { path: path }).then(function(res) {
        if (res.error) throw new Error(res.error.message);
        return res.result.target;
      });
    }
  };

  // Fetch proxy
  var origFetch = globalThis.fetch;
  globalThis.fetch = function(url, options) {
    var fetchParams = {
      url: typeof url === "string" ? url : url.url,
      method: (options && options.method) || "GET",
      headers: (options && options.headers) || {},
      body: (options && options.body) || undefined
    };
    return sendRequest("fetch", fetchParams).then(function(res) {
      if (res.error) throw new TypeError(res.error.message);
      var r = res.result;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        statusText: "",
        headers: new Headers(r.headers || {}),
        text: function() { return Promise.resolve(r.body); },
        json: function() { return Promise.resolve(JSON.parse(r.body)); }
      };
    });
  };

  // Stdin
  var stdinBuffer = [];
  var stdinWaiters = [];
  var stdinClosed = false;

  globalThis.__stdin = {
    read: function() {
      if (stdinBuffer.length > 0) {
        return Promise.resolve(stdinBuffer.shift());
      }
      if (stdinClosed) {
        return Promise.resolve(null);
      }
      sendNotification("stdin.request", {});
      return new Promise(function(resolve) {
        stdinWaiters.push(resolve);
      });
    }
  };

  // Message handler
  __bridge_onMessage(function(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }

    // Response to our request
    if (msg.id && !msg.method) {
      var pending = pendingRequests[msg.id];
      if (pending) {
        delete pendingRequests[msg.id];
        pending.resolve(msg);
      }
      return;
    }

    // Request from IDE
    if (msg.id && msg.method) {
      var method = msg.method;
      var params = msg.params || {};

      if (method === "exec") {
        var fn = new Function("return (async function() {\\n  return eval(" + JSON.stringify(params.code) + ");\\n})()");
        fn().then(function(result) {
          sendResponse(msg.id, { result: result });
        }).catch(function(err) {
          sendErrorResponse(msg.id, "RUNTIME_ERROR", err && err.message ? err.message : String(err));
        });
        return;
      }

      if (method === "eval") {
        try {
          var evalResult = (0, eval)(params.expression);
          if (evalResult && typeof evalResult.then === "function") {
            evalResult.then(function(r) {
              sendResponse(msg.id, { result: r });
            }).catch(function(err) {
              sendErrorResponse(msg.id, "RUNTIME_ERROR", err && err.message ? err.message : String(err));
            });
          } else {
            sendResponse(msg.id, { result: evalResult });
          }
        } catch (err) {
          sendErrorResponse(msg.id, "RUNTIME_ERROR", err && err.message ? err.message : String(err));
        }
        return;
      }

      if (method === "kill") {
        sendResponse(msg.id, { ok: true });
        return;
      }

      if (method === "reset") {
        replScope = {};
        sendResponse(msg.id, { ok: true });
        return;
      }
    }

    // Notification from IDE
    if (!msg.id && msg.method) {
      if (msg.method === "stdin.write") {
        var data = msg.params && msg.params.data;
        if (stdinWaiters.length > 0) {
          stdinWaiters.shift()(data);
        } else {
          stdinBuffer.push(data);
        }
      }
      if (msg.method === "stdin.end") {
        stdinClosed = true;
        while (stdinWaiters.length > 0) {
          stdinWaiters.shift()(null);
        }
      }
    }
  });
})();`;
