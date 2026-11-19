// VLSM planner: splits one network into right-sized subnets (largest first) and
// generates matching Cisco IOS configuration. Pure functions, no DOM.

export function ipToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip).trim());
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts.reduce((acc, p) => acc * 256 + p, 0) >>> 0;
}

export function intToIp(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function prefixToMask(prefix) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}

/** Smallest subnet (largest prefix) with at least `hosts` usable addresses. Never smaller than /30. */
export function prefixForHosts(hosts) {
  let bits = 2;
  while ((2 ** bits) - 2 < hosts) bits++;
  return 32 - bits;
}

export function parseCidr(text) {
  const m = /^\s*([\d.]+)\s*\/\s*(\d{1,2})\s*$/.exec(String(text ?? ""));
  if (!m) return { ok: false, error: "Enter the network as address/prefix, e.g. 192.168.10.0/24." };
  const ip = ipToInt(m[1]);
  const prefix = Number(m[2]);
  if (ip === null) return { ok: false, error: `"${m[1]}" is not a valid IPv4 address.` };
  if (prefix < 8 || prefix > 30) return { ok: false, error: "Use a prefix between /8 and /30." };
  const network = (ip & prefixToMask(prefix)) >>> 0;
  const note = network !== ip
    ? `${intToIp(ip)} is a host address; using its network ${intToIp(network)}/${prefix}.`
    : null;
  return { ok: true, network, prefix, note };
}

const RESERVED_VLANS = new Set([1, 1002, 1003, 1004, 1005]);

/** Cisco-safe name: letters, digits, _ and -, max 32 characters. */
export function cleanName(name) {
  const s = String(name ?? "").trim().replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return s.toUpperCase();
}

/**
 * @param {string} baseCidr e.g. "10.10.0.0/22"
 * @param {{name:string, hosts:number|string, vlan?:number|string}[]} requests
 */
export function planVlsm(baseCidr, requests) {
  const base = parseCidr(baseCidr);
  if (!base.ok) return base;
  if (!Array.isArray(requests) || requests.length === 0) return { ok: false, error: "Add at least one department or subnet." };
  if (requests.length > 256) return { ok: false, error: "Too many subnets (maximum 256)." };

  const seenNames = new Set();
  const seenVlans = new Set();
  const items = [];
  for (const [i, r] of requests.entries()) {
    const label = `Row ${i + 1}`;
    const name = cleanName(r.name);
    if (!name) return { ok: false, error: `${label}: give the subnet a name.` };
    if (seenNames.has(name)) return { ok: false, error: `${label}: the name ${name} is used twice.` };
    seenNames.add(name);

    const hosts = Number(r.hosts);
    if (!Number.isInteger(hosts) || hosts < 1) return { ok: false, error: `${label} (${name}): hosts must be a whole number of at least 1.` };
    if (hosts > 16777214) return { ok: false, error: `${label} (${name}): too many hosts.` };

    let vlan = null;
    if (r.vlan !== undefined && r.vlan !== null && String(r.vlan).trim() !== "") {
      vlan = Number(r.vlan);
      if (!Number.isInteger(vlan) || vlan < 2 || vlan > 4094 || RESERVED_VLANS.has(vlan)) {
        return { ok: false, error: `${label} (${name}): VLAN must be 2-4094 and not 1002-1005.` };
      }
      if (seenVlans.has(vlan)) return { ok: false, error: `${label} (${name}): VLAN ${vlan} is used twice.` };
      seenVlans.add(vlan);
    }
    items.push({ order: i, name, hosts, vlan });
  }

  // Auto-number VLANs 10, 20, 30... for rows that didn't specify one, skipping used ids.
  let next = 10;
  for (const it of items) {
    if (it.vlan !== null) continue;
    while (seenVlans.has(next) || RESERVED_VLANS.has(next)) next += 10;
    it.vlan = next;
    seenVlans.add(next);
    next += 10;
  }

  const baseSize = 2 ** (32 - base.prefix);
  const baseEnd = base.network + baseSize; // exclusive
  const needed = items.reduce((sum, it) => sum + 2 ** (32 - prefixForHosts(it.hosts)), 0);

  // Largest first keeps every block aligned on its own size boundary.
  const sorted = [...items].sort((a, b) => b.hosts - a.hosts || a.order - b.order);
  let cursor = base.network;
  const subnets = [];
  for (const it of sorted) {
    const prefix = prefixForHosts(it.hosts);
    const size = 2 ** (32 - prefix);
    if (prefix < base.prefix || cursor + size > baseEnd) {
      return {
        ok: false,
        error: `${it.name} (${it.hosts} hosts) doesn't fit. The plan needs ${needed} addresses but ` +
          `${intToIp(base.network)}/${base.prefix} only has ${baseSize}. Use a bigger network (smaller prefix) or fewer hosts.`,
      };
    }
    const network = cursor >>> 0;
    const broadcast = (cursor + size - 1) >>> 0;
    subnets.push({
      name: it.name,
      vlan: it.vlan,
      hostsRequested: it.hosts,
      network: intToIp(network),
      prefix,
      cidr: `${intToIp(network)}/${prefix}`,
      mask: intToIp(prefixToMask(prefix)),
      wildcard: intToIp(~prefixToMask(prefix) >>> 0),
      gateway: intToIp(network + 1),
      firstUsable: intToIp(network + 1),
      lastUsable: intToIp(broadcast - 1),
      broadcast: intToIp(broadcast),
      usable: size - 2,
      spare: size - 2 - it.hosts,
    });
    cursor += size;
  }

  return {
    ok: true,
    base: `${intToIp(base.network)}/${base.prefix}`,
    note: base.note,
    subnets,
    totalAddresses: baseSize,
    allocated: needed,
    free: baseSize - needed,
    nextFree: cursor < baseEnd ? intToIp(cursor) : null,
    utilisation: Math.round((needed / baseSize) * 1000) / 10,
  };
}

/** Cisco IOS config for a layer-3 switch: VLANs, SVI gateways and DHCP pools. */
export function ciscoConfig(plan, { dns = "8.8.8.8", domain = "" } = {}) {
  if (!plan?.ok) return "";
  const dnsIp = ipToInt(dns) === null ? "8.8.8.8" : dns.trim();
  const lines = [
    `! VLSM plan for ${plan.base} - generated by vlsm-network-planner`,
    "! Paste in global configuration mode on a layer-3 switch.",
    "!",
    "ip routing",
    "!",
    "! ---- VLANs ----",
  ];
  for (const s of plan.subnets) lines.push(`vlan ${s.vlan}`, ` name ${s.name}`, "!");

  lines.push("! ---- Gateways (SVIs) ----");
  for (const s of plan.subnets) {
    lines.push(
      `interface Vlan${s.vlan}`,
      ` description ${s.name} gateway - ${s.cidr}`,
      ` ip address ${s.gateway} ${s.mask}`,
      " no shutdown",
      "!",
    );
  }

  lines.push("! ---- DHCP ----");
  for (const s of plan.subnets) lines.push(`ip dhcp excluded-address ${s.gateway}`);
  lines.push("!");
  const cleanDomain = String(domain).trim().replace(/[^A-Za-z0-9.-]/g, "");
  for (const s of plan.subnets) {
    lines.push(
      `ip dhcp pool ${s.name}`,
      ` network ${s.network} ${s.mask}`,
      ` default-router ${s.gateway}`,
      ` dns-server ${dnsIp}`,
    );
    if (cleanDomain) lines.push(` domain-name ${cleanDomain}`);
    lines.push("!");
  }
  lines.push("end");
  return lines.join("\n");
}

export function toCsv(plan) {
  if (!plan?.ok) return "";
  const head = "Name,VLAN,Hosts needed,Network,Mask,Gateway,First usable,Last usable,Broadcast,Usable,Spare";
  const rows = plan.subnets.map((s) =>
    [s.name, s.vlan, s.hostsRequested, s.cidr, s.mask, s.gateway, s.firstUsable, s.lastUsable, s.broadcast, s.usable, s.spare].join(","));
  return [head, ...rows].join("\n");
}
