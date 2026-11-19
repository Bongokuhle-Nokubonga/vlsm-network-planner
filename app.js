import { planVlsm, ciscoConfig, toCsv } from "./vlsm.js";

const $ = (id) => document.getElementById(id);

const EXAMPLES = {
  office: { base: "192.168.10.0/24", rows: [["Sales", 60], ["Admin", 25], ["IT", 12], ["Printers", 6], ["WAN-Link", 2]] },
  school: { base: "10.20.0.0/22", rows: [["Students", 400], ["Staff", 120], ["Lab", 60], ["WiFi-Guest", 100], ["Servers", 14]] },
  tight: { base: "192.168.1.0/24", rows: [["Warehouse", 200], ["Office", 100]] },
};

function addRow(name = "", hosts = "", vlan = "") {
  const tr = document.createElement("tr");
  const cells = [
    ["text", name, "Name", "e.g. Sales"],
    ["number", hosts, "Hosts needed", "e.g. 50"],
    ["number", vlan, "VLAN id", "auto"],
  ].map(([type, value, label, placeholder]) => {
    const td = document.createElement("td");
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute("aria-label", label);
    if (type === "number") input.min = "1";
    td.append(input);
    return td;
  });
  const del = document.createElement("td");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "remove";
  btn.textContent = "×";
  btn.setAttribute("aria-label", "Remove row");
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

let lastPlan = null;

function cell(tr, text) {
  const td = document.createElement("td");
  td.textContent = text;
  tr.append(td);
}

// All output uses textContent: names come from user input.
function run() {
  const plan = planVlsm($("base").value, readRows());
  lastPlan = plan;
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
  $("bar").style.width = `${plan.utilisation}%`;

  const body = $("plan");
  body.replaceChildren();
  for (const s of plan.subnets) {
    const tr = document.createElement("tr");
    [s.name, s.vlan, s.hostsRequested, s.cidr, s.mask, s.gateway, `${s.firstUsable} - ${s.lastUsable}`, s.broadcast, s.spare]
      .forEach((v) => cell(tr, String(v)));
    body.append(tr);
  }
  $("config").textContent = ciscoConfig(plan, { dns: $("dns").value });
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("add").addEventListener("click", () => addRow());
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => loadExample(b.dataset.example)));

$("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("config").textContent);
    $("copy").textContent = "Copied";
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
