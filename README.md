# VLSM Network Planner

Plan an IP addressing scheme the way it's done on a real network: list the departments and how many
devices each needs, and the planner splits your network into **right-sized subnets (VLSM)** and writes
the **Cisco IOS configuration** to build it.

**Try it:** https://bongokuhle-nokubonga.github.io/vlsm-network-planner/

## What it does

1. **Sizes each subnet** to the smallest block that fits the host count (+2 for network and broadcast).
   50 hosts → /26, 100 hosts → /25, a 2-host WAN link → /30.
2. **Allocates largest first**, so every block lands on its natural boundary with no overlaps or gaps.
3. Shows network, mask, gateway, usable range, broadcast and spare addresses for each subnet, plus how
   much of the network is used and the next free address.
4. **Generates Cisco IOS config** for a layer-3 switch:

```
ip routing
vlan 10
 name SALES
interface Vlan10
 description SALES gateway - 192.168.10.0/26
 ip address 192.168.10.1 255.255.255.192
 no shutdown
ip dhcp excluded-address 192.168.10.1
ip dhcp pool SALES
 network 192.168.10.0 255.255.255.192
 default-router 192.168.10.1
 dns-server 8.8.8.8
```

5. Exports the plan as **CSV** for documentation.

If the plan doesn't fit, it says exactly how many addresses you need and how many the network has.

## Details handled

- VLAN ids are auto-numbered 10, 20, 30… or set per row; duplicates and reserved VLANs (1, 1002-1005) are rejected
- Names are cleaned to be valid Cisco identifiers (`Finance & Admin` → `FINANCE_ADMIN`)
- A host address as the base (`192.168.1.77/24`) is corrected to its network, with a note
- Works across octet boundaries (for example a /22 campus network)

## Tests

The logic is in [`vlsm.js`](vlsm.js) with no browser code, covered by **11 test groups**: the
textbook 192.168.1.0/24 example, octet boundaries, exact-fit sizes (126 hosts → /25, 127 → /24),
VLAN rules, "doesn't fit" errors, input validation, name cleaning, the generated config and CSV.

- In the browser: [`tests.html`](https://bongokuhle-nokubonga.github.io/vlsm-network-planner/tests.html)
- In Node: `node tests/run.mjs` (runs on every push with GitHub Actions)

Related: my [Subnet Calculator](https://github.com/Bongokuhle-Nokubonga/subnet-calculator) for single-subnet maths.
