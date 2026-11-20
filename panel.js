// 思维导图：当前笔记的标题和列表画成一棵向右展开的树，根在左上，
// 根节点就是这篇笔记的文件名，正文的一级标题也是它的分支。
// 侧栏和新标签页里画的是同一张图：右上角的 − / + 缩放，
// 按住鼠标（左键或右键）在图上拖着走可以平移；笔记改动时重画。
// 「导出图片」把整张图重画成一张独立的 SVG 交给 host.js 存成文件。
// 有子节点的节点，右侧线条汇聚的地方画一个小圆圈：点它收起或展开子节点，
// 圈里一道横线是展开着，再加一道竖线是收着。点末端节点跳到笔记里的那一行。
// 节点框的宽窄按真正画出来的文字量：页面外的尺子用同一套字体量一遍，
// 中文、emoji、主题换的字体都不会冒出框外。
const api = acquireTextusApi();
  const t = api.t;

const SVG = "http://www.w3.org/2000/svg";
const ROW = 26;
const COL_GAP = 26;
const PAD_X = 7;
const FONT = 12;
// 收起、展开用的小圆圈：半径和圈里那两道线的一半长度。
const FOLD_R = 5.5;
const FOLD_ARM = 2.5;
// 缩放档位：1 是「刚好放得下」的尺寸，右上角显示的是相对它的百分比。
const STEPS = [0.3, 0.4, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];

const box = document.getElementById("map");
const empty = document.getElementById("empty");
const nameLabel = document.getElementById("name");
const fullButton = document.getElementById("full");
const exportButton = document.getElementById("export");
const zoomLabel = document.getElementById("zoom-label");
const zoomIn = document.getElementById("zoom-in");
const zoomOut = document.getElementById("zoom-out");
const measure = document.createElement("canvas").getContext("2d");

// 量字宽用的尺子：藏在页面左边外面，字体跟节点上的字一样。
const ruler = document.createElementNS(SVG, "svg");
ruler.setAttribute("class", "ruler");
ruler.setAttribute("aria-hidden", "true");
document.body.append(ruler);

let source = null;
let drawnWidth = 0;
// 页面上还没有宽度时等下一帧再画，最多等这么久（约两秒）。
let waiting = 0;
// 画好的图和它的原尺寸：换档时只改 SVG 画出来的大小，不重新排。
// edges / items 是画过的连线和节点，导出图片时照着它们重画一张。
let view = null;
let step = STEPS.indexOf(1);
let zoom = STEPS[step];
// 折叠起来的节点，按它在树里的位置记，重画之后仍然是折着的。
const folded = new Set();

// 标签上只留文字：链接、图片、[[双链]]、强调符号都去掉。
function plain(text) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
}

// 写进 SVG 前把 & < > " 换成实体，标题里有尖括号也不会把文件弄坏。
function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// 文件名：路径的最后一段去掉扩展名，不带路径。
function fileName(path) {
  const file = String(path || "").split(/[\\/]/).pop() || "";
  return file.replace(/\.[^.]+$/, "").trim();
}

// 开头 front matter 之后的第一行，没有 front matter 就是第 0 行。
function bodyStart(lines) {
  if (!lines.length || lines[0].trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i + 1;
  }
  return lines.length;
}

// 标题按 # 的个数分层，列表项按缩进分层；代码块里的内容不算。
function outline(markdown, path) {
  const lines = markdown.split("\n");
  const start = bodyStart(lines);
  // 根节点就是这篇笔记的文件名（不带路径），不拿正文的标题顶替。
  const root = { text: fileName(path) || t("note"), children: [], line: 0 };
  const stack = [{ node: root, level: 0 }];
  const indents = [];
  let heading = 0;
  let fence = null;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const mark = /^\s*(`{3,}|~{3,})/.exec(line);
    if (mark) {
      if (!fence) fence = mark[1][0];
      else if (mark[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    let level = 0;
    let text = "";
    const h = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line);
    const li = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*\S.*)$/.exec(line);
    if (h) {
      heading = h[1].length;
      level = heading;
      text = h[2];
      indents.length = 0;
    } else if (li) {
      const indent = li[1].replace(/\t/g, "  ").length;
      while (indents.length && indents[indents.length - 1] >= indent) indents.pop();
      level = heading + 1 + indents.length;
      indents.push(indent);
      text = li[2];
    } else {
      continue;
    }
    const label = plain(text);
    if (!label) continue;
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    const node = { text: label, children: [], line: i };
    stack[stack.length - 1].node.children.push(node);
    stack.push({ node: node, level: level });
  }
  return root;
}

// 把每段文字真正画出来有多宽量一遍：一次排完再一个个读，页面只重排一次。
// canvas 估出来的宽度和实际画出来的字能差一截（中文、emoji、系统字体替换），
// 框就装不下字，所以这里以页面量的为准，量不出来才退回 canvas 估一个。
function measureWidths(texts) {
  const widths = new Map();
  const list = [];
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] || "");
    if (widths.has(text)) continue;
    widths.set(text, 0);
    list.push(text);
  }
  try {
    ruler.replaceChildren();
    list.forEach(function (text) {
      const item = document.createElementNS(SVG, "text");
      item.textContent = text;
      ruler.append(item);
    });
    const items = ruler.querySelectorAll("text");
    for (let i = 0; i < items.length; i++) {
      const text = list[i];
      const width = items[i].getComputedTextLength ? items[i].getComputedTextLength() : 0;
      if (typeof width === "number" && isFinite(width) && width > 0) widths.set(text, width);
    }
    ruler.replaceChildren();
  } catch (err) {
    ruler.replaceChildren();
  }
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  measure.font = FONT + "px " + family;
  list.forEach(function (text) {
    if (widths.get(text) > 0) return;
    widths.set(text, measure.measureText(text).width);
  });
  return widths;
}

// 图上画出来的大小：原尺寸乘上「刚好放得下」的比例，再乘缩放档位。
function scaled(width, height, fit) {
  return {
    w: Math.max(1, Math.round(width * fit * zoom)),
    h: Math.max(1, Math.round(height * fit * zoom)),
  };
}

function paint(root) {
  // 先量这一棵树里所有节点的字，收着的那几支也一起量，展开时不用再量。
  const all = [];
  const collect = function (node) {
    all.push(node.text);
    node.children.forEach(collect);
  };
  collect(root);
  const widths = measureWidths(all);

  const cols = [];
  let rows = 0;

  // 末端节点自上而下各占一行，有分支的节点摆在第一个和最后一个孩子中间。
  const walk = function (node, depth, key) {
    node.depth = depth;
    node.key = key;
    node.collapsed = node.children.length > 0 && folded.has(key);
    // 框 = 量出来的字宽 + 两边留白 + 1 像素，圆角处也不会压到字上。
    node.w = Math.ceil(widths.get(node.text) || 0) + PAD_X * 2 + 1;
    cols[depth] = Math.max(cols[depth] || 0, node.w);
    const kids = node.collapsed ? [] : node.children;
    if (!kids.length) {
      node.top = rows * ROW;
      rows += 1;
    } else {
      kids.forEach(function (kid, index) {
        walk(kid, depth + 1, key + "/" + index);
      });
      node.top = (kids[0].top + kids[kids.length - 1].top) / 2;
    }
  };
  walk(root, 0, "");

  const xs = [];
  let width = 0;
  for (let depth = 0; depth < cols.length; depth++) {
    xs[depth] = width;
    width += (cols[depth] || 0) + COL_GAP;
  }
  width = Math.max(1, width - COL_GAP);
  const height = Math.max(1, rows * ROW);

  // 窄的地方（侧栏）先按比例缩小，缩到字太小就不再缩，改为横向滚动；
  // 标签页宽，宽度够就按原尺寸画。右上角的缩放按钮在它的基础上再放大缩小。
  const available = box.clientWidth - 8;
  const fit = Math.max(0.6, Math.min(1, available / width));

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "map");
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const edges = [];
  const items = [];
  view = { svg: svg, width: width, height: height, fit: fit, edges: edges, items: items };
  const size = scaled(width, height, fit);
  svg.setAttribute("width", String(size.w));
  svg.setAttribute("height", String(size.h));
  const links = document.createElementNS(SVG, "g");
  const nodes = document.createElementNS(SVG, "g");

  const add = function (node, parent) {
    const cy = node.top + ROW / 2;
    if (parent) {
      const px = xs[parent.depth] + parent.w;
      const py = parent.top + ROW / 2;
      const cx = xs[node.depth];
      const bend = Math.max(8, (cx - px) * 0.5);
      edges.push({ px: px, py: py, cx: cx, cy: cy, bend: bend });
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("class", "link");
      path.setAttribute(
        "d",
        "M" + px + " " + py + "C" + (px + bend) + " " + py + " " + (cx - bend) + " " + cy + " " + cx + " " + cy,
      );
      links.append(path);
    }
    const group = document.createElementNS(SVG, "g");
    group.setAttribute(
      "class",
      "node" +
        (node.depth === 0 ? " root" : "") +
        (node.children.length ? " branch" : "") +
        (node.collapsed ? " folded" : ""),
    );
    const tip = document.createElementNS(SVG, "title");
    tip.textContent = node.text;
    const rect = document.createElementNS(SVG, "rect");
    rect.setAttribute("x", String(xs[node.depth]));
    rect.setAttribute("y", String(cy - 9));
    rect.setAttribute("width", String(node.w));
    rect.setAttribute("height", "18");
    rect.setAttribute("rx", "4");
    const label = document.createElementNS(SVG, "text");
    label.setAttribute("x", String(xs[node.depth] + PAD_X));
    label.setAttribute("y", String(cy + 4));
    label.textContent = node.text;
    group.append(tip, rect, label);
    // 有子节点：在节点右端、子节点连线汇聚的地方画个小圆圈，点它收起或展开。
    let fold = null;
    if (node.children.length) {
      const fx = xs[node.depth] + node.w + FOLD_R;
      fold = { x: fx, y: cy, folded: node.collapsed };
      const dot = document.createElementNS(SVG, "circle");
      dot.setAttribute("class", "fold");
      dot.setAttribute("cx", String(fx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", String(FOLD_R));
      const dotTip = document.createElementNS(SVG, "title");
      dotTip.textContent = node.collapsed ? t("expandChildren") : t("collapseChildren");
      dot.append(dotTip);
      // 圈里一道横线是展开着；收着的时候再补一道竖线，成了个加号。
      const bar = function (x1, y1, x2, y2) {
        const line = document.createElementNS(SVG, "path");
        line.setAttribute("class", "fold-sign");
        line.setAttribute("d", "M" + x1 + " " + y1 + "L" + x2 + " " + y2);
        return line;
      };
      group.append(dot, bar(fx - FOLD_ARM, cy, fx + FOLD_ARM, cy));
      if (node.collapsed) group.append(bar(fx, cy - FOLD_ARM, fx, cy + FOLD_ARM));
    }
    items.push({
      x: xs[node.depth],
      y: cy - 9,
      w: node.w,
      text: node.text,
      root: node.depth === 0,
      branch: node.children.length > 0,
      folded: node.collapsed,
      fold: fold,
    });
    group.addEventListener("click", function () {
      // 刚才那一下是抓着图拖，不是点节点。
      if (dragged) {
        dragged = false;
        return;
      }
      try {
        if (node.children.length) {
          if (folded.has(node.key)) folded.delete(node.key);
          else folded.add(node.key);
          draw();
        } else {
          api.postMessage({ type: "reveal", line: node.line });
        }
      } catch (err) {
        show(String((err && err.message) || err));
      }
    });
    nodes.append(group);
    if (!node.collapsed) node.children.forEach((kid) => add(kid, node));
  };
  add(root, null);

  svg.append(links, nodes);
  box.replaceChildren(svg);
  updateZoom();
  drawnWidth = box.clientWidth;
}

// 导出用的图：把画过的那张在别处重画一遍，主题的颜色和字体都写进属性里，
// 存成文件以后不靠样式表也是现在看到的样子。整张按原尺寸导出，不跟缩放走。
function exportMarkup() {
  if (!view) throw new Error(t("notDrawn"));
  const theme = getComputedStyle(document.documentElement);
  // 主题的变量偶尔是渐变或空值，画图只认纯色，认不出就用备用色。
  const color = function (name, fallback) {
    const value = theme.getPropertyValue(name).trim();
    return value && /^(#|rgb|hsl)/i.test(value) ? value : fallback;
  };
  const accent = color("--ui-accent", "#3b82f6");
  const text = color("--ui-text", "#222222");
  const border = color("--ui-border", "#d4d4d4");
  const subtle = color("--ui-subtle", "#f4f4f5");
  const background = color("--ui-bg", "#ffffff");
  const family = getComputedStyle(document.body).fontFamily || "sans-serif";
  const width = view.width;
  const height = view.height;
  const out = [
    '<svg xmlns="' +
      SVG +
      '" width="' +
      width +
      '" height="' +
      height +
      '" viewBox="0 0 ' +
      width +
      " " +
      height +
      '">',
    '<rect width="' + width + '" height="' + height + '" fill="' + escapeXml(background) + '"/>',
  ];
  view.edges.forEach(function (edge) {
    out.push(
      '<path d="M' +
        edge.px +
        " " +
        edge.py +
        "C" +
        (edge.px + edge.bend) +
        " " +
        edge.py +
        " " +
        (edge.cx - edge.bend) +
        " " +
        edge.cy +
        " " +
        edge.cx +
        " " +
        edge.cy +
        '" fill="none" stroke="' +
        escapeXml(border) +
        '" stroke-width="1.2"/>',
    );
  });
  view.items.forEach(function (item) {
    const fill = item.root ? accent : subtle;
    const stroke = item.root || item.branch ? accent : border;
    out.push(
      '<rect x="' +
        item.x +
        '" y="' +
        item.y +
        '" width="' +
        item.w +
        '" height="18" rx="4" fill="' +
        escapeXml(fill) +
        '" stroke="' +
        escapeXml(stroke) +
        '"' +
        (item.folded ? ' stroke-dasharray="3 2"' : "") +
        "/>",
    );
    out.push(
      '<text x="' +
        (item.x + PAD_X) +
        '" y="' +
        (item.y + 13) +
        '" font-family="' +
        escapeXml(family) +
        '" font-size="' +
        FONT +
        '" fill="' +
        escapeXml(item.root ? "#ffffff" : text) +
        '">' +
        escapeXml(item.text) +
        "</text>",
    );
    // 收起、展开用的小圆圈也跟着画进图片里。
    if (item.fold) {
      out.push(
        '<circle cx="' +
          item.fold.x +
          '" cy="' +
          item.fold.y +
          '" r="' +
          FOLD_R +
          '" fill="' +
          escapeXml(background) +
          '" stroke="' +
          escapeXml(accent) +
          '" stroke-width="1.2"/>',
      );
      const dotBar = function (x1, y1, x2, y2) {
        out.push(
          '<path d="M' +
            x1 +
            " " +
            y1 +
            "L" +
            x2 +
            " " +
            y2 +
            '" fill="none" stroke="' +
            escapeXml(accent) +
            '" stroke-width="1.2" stroke-linecap="round"/>',
        );
      };
      dotBar(item.fold.x - FOLD_ARM, item.fold.y, item.fold.x + FOLD_ARM, item.fold.y);
      if (item.fold.folded) {
        dotBar(item.fold.x, item.fold.y - FOLD_ARM, item.fold.x, item.fold.y + FOLD_ARM);
      }
    }
  });
  out.push("</svg>");
  return out.join("\n");
}

function updateZoom() {
  zoomLabel.textContent = Math.round(zoom * 100) + "%";
  zoomOut.disabled = step <= 0;
  zoomIn.disabled = step >= STEPS.length - 1;
}

// 换一档：只改 SVG 画出来的大小，围着看图时的中心点缩放。
function applyZoom() {
  if (!view) return;
  const oldW = parseFloat(view.svg.getAttribute("width")) || 1;
  const oldH = parseFloat(view.svg.getAttribute("height")) || 1;
  const size = scaled(view.width, view.height, view.fit);
  const cx = (box.scrollLeft + box.clientWidth / 2) / oldW;
  const cy = (box.scrollTop + box.clientHeight / 2) / oldH;
  view.svg.setAttribute("width", String(size.w));
  view.svg.setAttribute("height", String(size.h));
  box.scrollLeft = Math.max(0, cx * size.w - box.clientWidth / 2);
  box.scrollTop = Math.max(0, cy * size.h - box.clientHeight / 2);
  updateZoom();
}

function stepZoom(delta) {
  const next = Math.min(STEPS.length - 1, Math.max(0, step + delta));
  if (next === step) return;
  step = next;
  zoom = STEPS[step];
  applyZoom();
}

function show(text) {
  view = null;
  box.replaceChildren();
  empty.textContent = text;
  empty.hidden = false;
}

// 图还留着，只是弹一句提示：导出这一步出了问题不该把图弄没。
function tell(text) {
  try {
    api.postMessage({ type: "message", text: String(text) });
  } catch (err) {
    show(String(text));
  }
}

function draw() {
  if (source === null) return;
  // 标签页刚打开、侧栏还收着的时候还没有宽度：等下一帧再看，别就此什么也不画。
  if (!box.clientWidth) {
    if (waiting < 120) {
      waiting += 1;
      requestAnimationFrame(draw);
    }
    return;
  }
  waiting = 0;
  try {
    const root = outline(source.text, source.path);
    if (!root.children.length) {
      show(t("empty"));
      return;
    }
    empty.hidden = true;
    paint(root);
  } catch (err) {
    show(t("renderFailed", String((err && err.message) || err)));
  }
}

zoomIn.addEventListener("click", function () {
  try {
    stepZoom(1);
  } catch (err) {
    show(String((err && err.message) || err));
  }
});

zoomOut.addEventListener("click", function () {
  try {
    stepZoom(-1);
  } catch (err) {
    show(String((err && err.message) || err));
  }
});

// 点「全图」：侧栏里换个宽地方看同一张图。
fullButton.addEventListener("click", function () {
  try {
    api.postMessage({ type: "openTab" });
  } catch (err) {
    show(String((err && err.message) || err));
  }
});

// 点「导出图片」：把眼前的这张（折着的节点照旧折着）交给 host.js 存成文件。
exportButton.addEventListener("click", function () {
  try {
    if (!view) throw new Error(t("notDrawn"));
    api.postMessage({
      type: "export",
      svg: exportMarkup(),
      name: source ? fileName(source.path) : "",
    });
  } catch (err) {
    tell(t("exportFailed", String((err && err.message) || err)));
  }
});

// 按住鼠标（左键或右键）在图上拖着走，图跟着手走：按在节点上或空白处都一样。
// 拖开以后再松手，不当作点击，免得又折叠又跳转。
let drag = null;
let dragged = false;

function endDrag() {
  if (!drag) return;
  drag = null;
  box.classList.remove("panning");
}

box.addEventListener("contextmenu", function (event) {
  event.preventDefault();
});

box.addEventListener("mousedown", function (event) {
  if (event.button !== 0 && event.button !== 2) return;
  // 左键也拖得动，就不能顺手把标签上的文字选上。
  event.preventDefault();
  drag = { x: event.clientX, y: event.clientY, left: box.scrollLeft, top: box.scrollTop };
});

document.addEventListener("mousemove", function (event) {
  if (!drag) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  // 手抖几像素不算拖，仍然是一次点击。
  if (!dragged && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
  if (!dragged) {
    dragged = true;
    box.classList.add("panning");
  }
  box.scrollLeft = drag.left - dx;
  box.scrollTop = drag.top - dy;
});

document.addEventListener("mouseup", endDrag);
window.addEventListener("blur", endDrag);

function onMessage(message) {
  if (!message || message.type !== "text") return;
  const mode = message.mode === "tab" ? "tab" : "sidebar";
  // 标签页的标题就是笔记名，页面上不用再写一遍；侧栏里写出来。
  fullButton.hidden = mode === "tab" || !!message.problem;
  nameLabel.textContent = mode === "tab" ? "" : fileName(message.path);
  if (message.problem) {
    source = null;
    show(message.problem);
    return;
  }
  const path = String(message.path || "");
  // 换了一篇笔记就回到 100%，同一篇里打字时保持用户调好的大小。
  if (source && source.path !== path) {
    step = STEPS.indexOf(1);
    zoom = STEPS[step];
  }
  source = { text: String(message.text || ""), path: path };
  drawnWidth = -1;
  draw();
}

// 1.7 起消息接口叫 onDidReceiveMessage，早先的版本叫 onMessage。
  // The toolbar's labels and the empty note come from the strings, like
  // the rest of the panel.
  const fill = function (id, key, attribute) {
    const el = document.getElementById(id);
    if (!el) return;
    if (attribute) el.setAttribute(attribute, t(key));
    else el.textContent = t(key);
  };
  fill("full", "allView");
  fill("full", "openTab", "title");
  fill("export", "exportImage");
  fill("export", "saveImage", "title");
  fill("zoom-out", "zoomOut", "title");
  fill("zoom-in", "zoomIn", "title");
  fill("empty", "empty");

const listen = api.onDidReceiveMessage || api.onMessage;
if (listen) listen.call(api, onMessage);

// 侧栏拖宽拖窄、标签页改大小、展开收起：宽度变了才重画，免得抖动。
new ResizeObserver(function () {
  if (source === null) return;
  if (Math.round(box.clientWidth) === Math.round(drawnWidth)) return;
  draw();
}).observe(box);

// 主题的字体是异步装上的，装好以后字宽会变，重画一遍框才对得准。
if (document.fonts && document.fonts.ready) {
  document.fonts.ready
    .then(function () {
      if (source !== null) draw();
    })
    .catch(function () {});
}

api.postMessage({ type: "ready" });
