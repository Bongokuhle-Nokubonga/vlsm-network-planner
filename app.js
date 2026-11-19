import { planVlsm, ciscoConfig, toCsv } from "./vlsm.js";

const $ = (id) => document.getElementById(id);
const COLORS = 8; // matches --c0 ... --c7 in style.css

const EXAMPLES = {
  office: { base: "192.168.10.0/24", rows: [["Sales", 60], ["Admin", 25], ["IT", 12], ["Printers", 6], ["WAN-Link", 2]] },
  school: { base: "10.20.0.0/22", rows: [["Students", 400], ["Staff", 120], ["Lab", 60], ["WiFi-Guest", 100], ["Servers", 14]] },
  tight: { base: "192.168.1.0/24", rows: [["Warehouse", 200], ["Office", 100]] },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const color = (i) => `var(--c${i % COLORS})`;

function addRow(name = "", hosts = "", vlan = "") {
  const tr = document.createElement("tr");
  const cells = [
    ["text", name, "Department name", "e.g. Sales"],
    ["number", hosts, "Devices needed", "e.g. 50"],
    ["number", vlan, "VLAN id", "auto"],
  ].map(([type, value, label, placeholder], i) => {
    const td = document.createElement("td");
    if (i === 0) td.append(el("span", "dot"));
    const input = Object.assign(document.createElement("input"), { type, value, placeholder });
    input.setAttribute("aria-label", label);
    if (type === "number") input.min = "1";
    td.append(input);
    return td;
  });
  const del = document.createElement("td");
  const btn = el("button", "remove", "×");
  btn.type = "button";
  btn.setAttribute("aria-label", "Remove department");
  btn.addEventListener("click", () => tr.remove());
  del.append(btn);
  tr.append(...cells, del);
  $("rows").append(tr);
}

function readRows() {
  return [...$("rows").querySelectorAll("tr")]
    .map((tr) => tr.querySelectorAll("input"))
    .map(([n, h, v]) => ({ name: n.value, hosts: h.value, vlan: v.value }))
    .filter((r) => r.name.trim() || String(r.hosts).trim());
}

function loadExample(key) {
  const ex = EXAMPLES[key];
  $("base").value = ex.base;
  $("rows").replaceChildren();
  ex.rows.forEach(([n, h]) => addRow(n, h));
  run();
}

/** Colours each input row's dot to match its subnet in the map and table. */
function colourRows(plan) {
  const byName = new Map(plan?.ok ? plan.subnets.map((s, i) => [s.name, i]) : []);
  for (const tr of $("rows").querySelectorAll("tr")) {
    const name = tr.querySelector("input").value.trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32).toUpperCase();
    const dot = tr.querySelector(".dot");
    dot.style.background = byName.has(name) ? color(byName.get(name)) : "";
  }
}

function renderMap(plan) {
  const map = $("map");
  const legend = $("legend");
  map.replaceChildren();
  legend.replaceChildren();
  plan.subnets.forEach((s, i) => {
    const share = ((s.usable + 2) / plan.totalAddresses) * 100;
    const seg = el("div", "", share > 9 ? s.name : "");
    seg.style.flex = `0 0 ${share}%`;
    seg.style.background = color(i);
    seg.title = `${s.name}: ${s.cidr} (${s.usable + 2} addresses)`;
    map.append(seg);

    const li = el("li");
    const sw = el("i");
    sw.style.background = color(i);
    li.append(sw, el("span", "", `${s.name} `), el("b", "mono", s.cidr));
    legend.append(li);
  });
  if (plan.free > 0) {
    const li = el("li", "free");
    li.append(el("i"), el("span", "", `Free: ${plan.free} addresses`));
    legend.append(li);
  }
  const [first] = plan.base.split("/");
  $("mapStart").textContent = first;
  $("mapEnd").textContent = plan.subnets.length ? `${plan.totalAddresses} addresses` : "";
}

/** Light syntax colouring for the IOS config, built with DOM nodes (names are user input). */
function renderConfig(text) {
  const pre = $("config");
  pre.replaceChildren();
  const kw = /^(\s*)(ip dhcp excluded-address|ip dhcp pool|ip routing|interface|vlan|name|description|ip address|no shutdown|network|default-router|dns-server|domain-name|end)(\b.*)?$/;
  for (const line of text.split("\n")) {
    const row = el("span", "line");
    if (line.trim().startsWith("!")) {
      row.append(el("span", "cm", line));
    } else {
      const m = kw.exec(line);
      if (m) {
        row.append(m[1], el("span", "kw", m[2]));
        const rest = m[3] || "";
        for (const part of rest.split(/(\b\d{1,3}(?:\.\d{1,3}){3}\b)/)) {
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(part)) row.append(el("span", "ip", part));
          else if (part) row.append(part);
        }
      } else {
        row.append(line);
      }
    }
    pre.append(row);
  }
}

let lastPlan = null;
let lastConfig = "";

function run() {
  const plan = planVlsm($("base").value, readRows());
  lastPlan = plan;
  colourRows(plan);
  if (!plan.ok) {
    $("error").textContent = plan.error;
    $("result").hidden = true;
    return;
  }
  $("error").textContent = "";
  $("result").hidden = false;
  $("note").hidden = !plan.note;
  $("note").textContent = plan.note || "";
  $("sBase").textContent = plan.base;
  $("sUsed").textContent = `${plan.allocated} of ${plan.totalAddresses} (${plan.utilisation}%)`;
  $("sFree").textContent = `${plan.free} addresses`;
  $("sNext").textContent = plan.nextFree || "none (full)";

  renderMap(plan);

  const body = $("plan");
  body.replaceChildren();
  plan.subnets.forEach((s, i) => {
    const tr = document.createElement("tr");
    const name = el("td");
    const sw = el("i");
    sw.style.background = color(i);
    name.append(sw, s.name);
    const vlan = el("td");
    vlan.append(el("span", "vlan", String(s.vlan)));
    tr.append(name, vlan);
    [s.hostsRequested, s.cidr, s.mask, s.gateway, `${s.firstUsable} – ${s.lastUsable}`, s.broadcast, s.spare]
      .forEach((v) => tr.append(el("td", "", String(v))));
    body.append(tr);
  });

  lastConfig = ciscoConfig(plan, { dns: $("dns").value });
  renderConfig(lastConfig);
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("add").addEventListener("click", () => addRow());
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => loadExample(b.dataset.example)));

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastConfig);
    $("copy").textContent = "Copied ✓";
  } catch {
    $("copy").textContent = "Select and copy";
  }
  setTimeout(() => { $("copy").textContent = "Copy"; }, 1500);
});

$("csv").addEventListener("click", () => {
  if (!lastPlan?.ok) return;
  const url = URL.createObjectURL(new Blob([toCsv(lastPlan)], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "vlsm-plan.csv" });
  a.click();
  URL.revokeObjectURL(url);
});

loadExample("office");
