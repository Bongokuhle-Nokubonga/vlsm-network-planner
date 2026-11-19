import { planVlsm, ciscoConfig, toCsv, prefixForHosts, parseCidr, cleanName, ipToInt, intToIp } from "../vlsm.js";

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}: expected ${e}, got ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

export const cases = [
  ["IP conversion round-trips", () => {
    eq(intToIp(ipToInt("192.168.1.10")), "192.168.1.10", "round trip");
    eq(intToIp(ipToInt("255.255.255.255")), "255.255.255.255", "max");
    eq(ipToInt("256.1.1.1"), null, "octet > 255");
    eq(ipToInt("10.0.0"), null, "3 octets");
  }],

  ["Right-sized prefix for host counts", () => {
    eq(prefixForHosts(1), 30, "1 host");
    eq(prefixForHosts(2), 30, "2 hosts (point-to-point)");
    eq(prefixForHosts(3), 29, "3 hosts");
    eq(prefixForHosts(126), 25, "126 fits /25 exactly");
    eq(prefixForHosts(127), 24, "127 needs /24");
    eq(prefixForHosts(254), 24, "254 fits /24");
  }],

  ["Classic textbook VLSM: 192.168.1.0/24", () => {
    const p = planVlsm("192.168.1.0/24", [
      { name: "Admin", hosts: 10 }, { name: "Sales", hosts: 100 }, { name: "WAN", hosts: 2 },
      { name: "IT", hosts: 50 }, { name: "HR", hosts: 20 },
    ]);
    ok(p.ok, p.error);
    eq(p.subnets.map((s) => s.name), ["SALES", "IT", "HR", "ADMIN", "WAN"], "largest first");
    eq(p.subnets.map((s) => s.cidr),
      ["192.168.1.0/25", "192.168.1.128/26", "192.168.1.192/27", "192.168.1.224/28", "192.168.1.240/30"], "allocations");
    const sales = p.subnets[0];
    eq([sales.mask, sales.gateway, sales.lastUsable, sales.broadcast, sales.usable, sales.spare],
      ["255.255.255.128", "192.168.1.1", "192.168.1.126", "192.168.1.127", 126, 26], "sales details");
    eq(p.subnets[4].wildcard, "0.0.0.3", "wildcard for /30");
    eq([p.allocated, p.free, p.nextFree, p.utilisation], [244, 12, "192.168.1.244", 95.3], "summary");
  }],

  ["Larger campus across octet boundaries: 10.20.0.0/22", () => {
    const p = planVlsm("10.20.0.0/22", [
      { name: "Students", hosts: 500 }, { name: "Staff", hosts: 200 }, { name: "Printers", hosts: 30 },
    ]);
    ok(p.ok, p.error);
    eq(p.subnets.map((s) => s.cidr), ["10.20.0.0/23", "10.20.2.0/24", "10.20.3.0/27"], "allocations (30 hosts fits a /27 exactly)");
    eq(p.subnets[0].lastUsable, "10.20.1.254", "last usable crosses octet");
  }],

  ["VLAN ids: auto-numbered, explicit kept, duplicates and reserved rejected", () => {
    const p = planVlsm("172.16.0.0/24", [
      { name: "A", hosts: 10, vlan: 20 }, { name: "B", hosts: 10 }, { name: "C", hosts: 10 },
    ]);
    ok(p.ok, p.error);
    const byName = Object.fromEntries(p.subnets.map((s) => [s.name, s.vlan]));
    eq(byName, { A: 20, B: 10, C: 30 }, "auto VLANs skip 20");
    ok(!planVlsm("172.16.0.0/24", [{ name: "A", hosts: 2, vlan: 5 }, { name: "B", hosts: 2, vlan: 5 }]).ok, "duplicate VLAN");
    ok(!planVlsm("172.16.0.0/24", [{ name: "A", hosts: 2, vlan: 1 }]).ok, "VLAN 1 reserved");
    ok(!planVlsm("172.16.0.0/24", [{ name: "A", hosts: 2, vlan: 1003 }]).ok, "1002-1005 reserved");
    ok(!planVlsm("172.16.0.0/24", [{ name: "A", hosts: 2, vlan: 5000 }]).ok, "out of range");
  }],

  ["Reports when the plan doesn't fit", () => {
    const p = planVlsm("192.168.1.0/24", [{ name: "Big", hosts: 200 }, { name: "Other", hosts: 100 }]);
    ok(!p.ok, "should fail");
    ok(/OTHER/.test(p.error) && /384/.test(p.error) && /256/.test(p.error), `helpful message: ${p.error}`);
    ok(!planVlsm("192.168.1.0/26", [{ name: "Big", hosts: 100 }]).ok, "single subnet larger than base");
  }],

  ["Validates input", () => {
    ok(!planVlsm("192.168.1.0", [{ name: "A", hosts: 2 }]).ok, "missing prefix");
    ok(!planVlsm("192.168.1.0/31", [{ name: "A", hosts: 2 }]).ok, "prefix too long");
    ok(!planVlsm("999.1.1.0/24", [{ name: "A", hosts: 2 }]).ok, "bad ip");
    ok(!planVlsm("10.0.0.0/24", []).ok, "no rows");
    ok(!planVlsm("10.0.0.0/24", [{ name: "", hosts: 2 }]).ok, "no name");
    ok(!planVlsm("10.0.0.0/24", [{ name: "A", hosts: 0 }]).ok, "zero hosts");
    ok(!planVlsm("10.0.0.0/24", [{ name: "A", hosts: 2.5 }]).ok, "fractional hosts");
    ok(!planVlsm("10.0.0.0/24", [{ name: "Lab", hosts: 2 }, { name: "lab", hosts: 2 }]).ok, "duplicate name");
  }],

  ["Host address as base is normalised with a note", () => {
    const c = parseCidr("192.168.1.77/24");
    eq([intToIp(c.network), c.prefix], ["192.168.1.0", 24], "normalised");
    ok(c.note && c.note.includes("192.168.1.0/24"), "note explains");
  }],

  ["Names are made safe for Cisco IOS", () => {
    eq(cleanName("Finance & Admin"), "FINANCE_ADMIN", "spaces and symbols");
    eq(cleanName("  wifi-guest "), "WIFI-GUEST", "trimmed");
    eq(cleanName("x".repeat(40)).length, 32, "max 32 chars");
    eq(cleanName("<script>"), "SCRIPT", "no angle brackets");
  }],

  ["Cisco config has VLANs, SVIs and DHCP pools", () => {
    const p = planVlsm("192.168.1.0/24", [{ name: "Sales", hosts: 100 }, { name: "IT", hosts: 50 }]);
    const cfg = ciscoConfig(p, { dns: "1.1.1.1", domain: "corp.local" });
    for (const line of [
      "ip routing", "vlan 10", " name SALES", "interface Vlan20",
      " ip address 192.168.1.129 255.255.255.192", " no shutdown",
      "ip dhcp excluded-address 192.168.1.1", "ip dhcp pool IT",
      " network 192.168.1.128 255.255.255.192", " default-router 192.168.1.129",
      " dns-server 1.1.1.1", " domain-name corp.local", "end",
    ]) ok(cfg.split("\n").includes(line), `missing line: "${line}"`);
    ok(ciscoConfig(p, { dns: "not-an-ip" }).includes(" dns-server 8.8.8.8"), "bad DNS falls back");
    eq(ciscoConfig({ ok: false }), "", "no config for failed plan");
  }],

  ["CSV export", () => {
    const p = planVlsm("192.168.1.0/24", [{ name: "Sales", hosts: 100 }]);
    const lines = toCsv(p).split("\n");
    eq(lines.length, 2, "header + 1 row");
    eq(lines[1], "SALES,10,100,192.168.1.0/25,255.255.255.128,192.168.1.1,192.168.1.1,192.168.1.126,192.168.1.127,126,26", "row");
  }],
];
