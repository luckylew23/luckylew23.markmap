// 思维导图：把在前的笔记整篇交给 panel.js 去画，不需要在文档里写
// ```markmap 代码块。命令一开就在新标签页里摊开整张图，标题跟文件标签页一样；
// 左侧栏里也有一份，点图标就能在那儿看。
// 页面上的「导出图片」把画好的图交回来，由这里写成一个 SVG 文件，
// 放在这篇笔记旁边（插件写不了二进制文件，SVG 是文本，也最清楚）。
// 最近读到的笔记留在 last 里：地图标签页自己在前时前面没有文档可读，
// 靠它把同一份内容送过去，标签页才不会空着。
exports.activate = function (context) {
  const PANEL = "luckylew23.markmap.panel";
  const VIEW = "luckylew23.markmap.view";

  let last = { text: "", path: "" };

  const nameOf = function (path) {
    const file = String(path || "").split(/[\\/]/).pop() || "";
    return file.replace(/\.[^.]+$/, "") || textus.l10n.t("note");
  };

  // 文件名里不能出现的字符换成短横，剩下的照用。
  const safeName = function (name) {
    const clean = String(name || "")
      .replace(/[\\/:*?"<>|]+/g, "-")
      .trim();
    return clean || textus.l10n.t("defaultName");
  };

  // 笔记所在的文件夹；笔记不在文件夹里时是空字符串，图片就放根上。
  const folderOf = function (path) {
    const parts = String(path || "").split(/[\\/]/);
    parts.pop();
    return parts.join("/");
  };

  // 标签页的标题跟那篇笔记的文件标签页一致：先看标签页列表里同一篇文档叫什么，
  // 问不到就用文件名（文件标签页平时写的也就是它）。
  const titleOf = function (path) {
    const fallback = nameOf(path);
    if (!path) return Promise.resolve(textus.l10n.t("view.title"));
    return Promise.resolve()
      .then(function () {
        return textus.layout.tabs();
      })
      .then(function (tabs) {
        const list = Array.isArray(tabs) ? tabs : [];
        for (let i = 0; i < list.length; i++) {
          const tab = list[i] || {};
          if (String(tab.path || "") !== path) continue;
          const title = tab.title || tab.label || tab.name;
          if (typeof title === "string" && title) return title;
        }
        return fallback;
      })
      .catch(function () {
        return fallback;
      });
  };

  // 设不了标题就留着清单里的名字，不算错。
  const setName = function (webview, text) {
    if (!webview.setTitle) return;
    try {
      const done = webview.setTitle(text);
      if (done && typeof done.catch === "function") done.catch(function () {});
    } catch (err) {
      // 标题只是锦上添花。
    }
  };

  // 前面有文档就读它；没有（地图标签页在前）就用上一次读到的。
  const snapshot = function () {
    return Promise.all([textus.editor.getText(), textus.editor.getPath()])
      .then(function (got) {
        const text = got[0] || "";
        const path = got[1] || "";
        if (text || path) last = { text: text, path: path };
        return { text: last.text, path: last.path };
      })
      .catch(function () {
        if (last.text || last.path) return { text: last.text, path: last.path };
        return { text: "", path: "", problem: textus.l10n.t("noNote") };
      });
  };

  const openTab = function () {
    // 先把这一篇记下来：标签页一开就换了前窗，那时已经读不到文档了。
    return snapshot()
      .then(function (got) {
        if (got.problem) return textus.ui.message(got.problem);
        // 全图开在前窗笔记的右侧，两栏并排看；窗口太窄放不下时就只是一个标签页。
        return textus.layout.openView(VIEW, { where: "beside" });
      })
      .catch(function (err) {
        return textus.ui.message(textus.l10n.t("tabFailed", String((err && err.message) || err)));
      });
  };

  // 把页面画好的 SVG 存成文件：先看有没有文件夹，再放在笔记旁边，
  // 同名的不覆盖，由 app 取一个空名字。
  const exportImage = function (message) {
    return Promise.resolve()
      .then(function () {
        return textus.files.root();
      })
      .then(function (root) {
        if (!root) throw new Error(textus.l10n.t("noFolder"));
        const dir = folderOf(last.path);
        const target = (dir ? dir + "/" : "") + safeName(message.name) + ".svg";
        return textus.files.create(target, String(message.svg || ""), { unique: true });
      })
      .then(function (written) {
        const path = typeof written === "string" ? written : (written && written.path) || "";
        return textus.ui.notice(textus.l10n.t("exported", path || textus.l10n.t("nextToNote")));
      })
      .catch(function (err) {
        return textus.ui.message(textus.l10n.t("exportFailed", String((err && err.message) || err)));
      });
  };

  const send = function (webview, mode) {
    return snapshot()
      .then(function (got) {
        const message = { type: "text", text: got.text, path: got.path, mode: mode };
        if (got.problem) message.problem = got.problem;
        return webview.postMessage(message).then(function () {
          if (mode !== "tab" || got.problem) return;
          return titleOf(last.path).then(function (title) {
            setName(webview, title);
          });
        });
      })
      .catch(function () {
        // 页面已经关掉，没什么要送的了。
      });
  };

  // 点末端节点：先在在前的笔记里跳；地图标签页在前时没有在前的笔记，
  // 改为打开那篇笔记的这一行。
  const reveal = function (line) {
    return textus.editor
      .reveal({ line: line })
      .catch(function () {
        if (!last.path) throw new Error(textus.l10n.t("noNote"));
        return textus.layout.open({ path: last.path, line: line });
      })
      .catch(function (err) {
        return textus.ui.message(textus.l10n.t("jumpFailed", String((err && err.message) || err)));
      });
  };

  const attach = function (id, mode) {
    context.subscriptions.push(
      textus.views.registerWebview(id, {
        resolve: function (webview) {
          const refresh = function () {
            send(webview, mode);
          };

          // 先接消息再放页面：页面一加载就发的 ready 不会丢。
          webview.onDidReceiveMessage(function (message) {
            if (!message || typeof message !== "object") return;
            try {
              if (message.type === "ready") refresh();
              else if (message.type === "openTab" && mode === "sidebar") openTab();
              else if (message.type === "reveal" && typeof message.line === "number") reveal(message.line);
              else if (message.type === "export") exportImage(message);
              else if (message.type === "message" && message.text) textus.ui.message(String(message.text));
            } catch (err) {
              textus.ui.message(String((err && err.message) || err));
            }
          });

          const watching = [textus.editor.onDidChange(refresh), textus.editor.onDidChangeActive(refresh)];
          const stop = function () {
            watching.forEach(function (d) {
              d.dispose();
            });
          };
          if (webview.onDidDispose) webview.onDidDispose(stop);

          setName(webview, textus.l10n.t("view.title"));
          context.plugin
            .readText("panel.html")
            .then(function (html) {
              webview.html = html;
              refresh();
            })
            .catch(function (err) {
              context.log.error(textus.l10n.t("pageFailed", String((err && err.message) || err)));
              return textus.ui.message(textus.l10n.t("panelPageFailed", String((err && err.message) || err)));
            });
        },
      }),
    );
  };

  attach(PANEL, "sidebar");
  attach(VIEW, "tab");

  context.subscriptions.push(textus.commands.register("luckylew23.markmap.open", openTab));
};
