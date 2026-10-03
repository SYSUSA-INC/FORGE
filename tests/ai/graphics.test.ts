/**
 * BL-FB-GEN-GRAPHICS — graphics suggestions, pure parts: spec hygiene,
 * heuristic proposals by section kind, SVG and Mermaid rendering.
 */
import { describe, expect, it } from "vitest";
import {
  GRAPHIC_LIMITS,
  proposeGraphics,
  renderDiagramSvg,
  sanitizeSpec,
  slugId,
  svgDataUri,
  toMermaid,
  type GraphicSpec,
} from "@/lib/graphics-logic";

const TECHNICAL =
  "Users reach the portal through single sign-on. The portal calls the API gateway, which routes requests to the ticketing service and the reporting dashboard. Both services write to the database and stream events to the SIEM. Everything runs in AWS GovCloud with monitoring on every node. Our transition completes within 30 days: during days 1-10 we inventory, during days 11-20 we migrate, and within 30 days we cut over.";

const MANAGEMENT =
  "The Program Manager owns delivery and reports to the COR monthly. A Deputy Program Manager handles staffing. The Technical Lead directs the engineers, the Quality Assurance Manager runs audits, and the Transition Manager owns the phase-in. First, we baseline the current state. Then, we stand up the team. Next, we rehearse the cutover. Finally, we assume full operations.";

describe("graphics logic", () => {
  it("cleans a raw spec: ids, labels, edge ends, caps", () => {
    const spec = sanitizeSpec({
      kind: "process",
      title: " Intake flow ",
      why: "Shows the order.",
      nodes: [
        { id: "a", label: "Receive request" },
        { id: "b", label: "Triage & assign" },
        { id: "a", label: "Duplicate id dropped" },
        { label: "" },
        { id: "c", label: "x".repeat(80) },
      ],
      edges: [
        { from: "a", to: "b", label: "within 1 day" },
        { from: "a", to: "b" },
        { from: "b", to: "zzz" },
        { from: "b", to: "b" },
        { from: "b", to: "c" },
      ],
    });
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe("Intake flow");
    expect(spec!.nodes.map((n) => n.label)).toEqual(["Receive request", "Triage & assign", "x".repeat(GRAPHIC_LIMITS.maxLabelChars)]);
    expect(spec!.edges).toEqual([
      { from: spec!.nodes[0]!.id, to: spec!.nodes[1]!.id, label: "within 1 day" },
      { from: spec!.nodes[1]!.id, to: spec!.nodes[2]!.id },
    ]);
    expect(sanitizeSpec({ kind: "pie", title: "x", nodes: [] })).toBeNull();
    expect(sanitizeSpec({ kind: "org", title: "One node", nodes: [{ id: "a", label: "A" }], edges: [] })).toBeNull();
    expect(slugId("API Gateway!", 3)).toBe("api_gateway_3");
  });

  it("proposes diagrams the section's own words support, favouring the section kind", () => {
    const tech = proposeGraphics({ kind: "technical", title: "Technical Approach", text: TECHNICAL });
    expect(tech.map((s) => s.kind)).toEqual(["architecture", "timeline"]);
    const arch = tech[0]!;
    expect(arch.nodes.map((n) => n.label)).toEqual(expect.arrayContaining(["Users", "Portal", "API Gateway", "Database", "SIEM"]));
    expect(arch.nodes.find((n) => n.label === "Users")?.group).toBe("Users");
    expect(arch.nodes.find((n) => n.label === "Database")?.group).toBe("Data");
    expect(arch.edges.length).toBeGreaterThan(0);
    expect(tech[1]!.nodes.map((n) => n.label)).toEqual(["Days 1-10 we inventory", "Days 11-20 we migrate"]);

    const mgmt = proposeGraphics({ kind: "management", title: "Management Approach", text: MANAGEMENT });
    expect(mgmt.map((s) => s.kind)).toEqual(["org", "process"]);
    const org = mgmt[0]!;
    expect(org.nodes[0]!.label).toBe("Program Manager");
    expect(org.edges.every((e) => e.from === org.nodes[0]!.id)).toBe(true);
    expect(mgmt[1]!.nodes.map((n) => n.label)).toEqual([
      "we baseline the current state",
      "we stand up the team",
      "we rehearse the cutover",
      "we assume full operations",
    ]);

    expect(proposeGraphics({ kind: "technical", title: "Intro", text: "We are pleased to submit this proposal." })).toEqual([]);
  });

  it("renders a self-contained SVG and the matching Mermaid", () => {
    const spec: GraphicSpec = {
      kind: "architecture",
      title: "Notional architecture <v1>",
      why: "",
      nodes: [
        { id: "u", label: "Users & operators", group: "Users" },
        { id: "p", label: "Portal", group: "Application" },
        { id: "d", label: "Database", group: "Data" },
      ],
      edges: [
        { from: "u", to: "p", label: "HTTPS" },
        { from: "p", to: "d" },
      ],
    };
    const svg = renderDiagramSvg(spec);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain("<title>Notional architecture &lt;v1&gt;</title>");
    expect(svg).toContain("Users &amp; operators");
    expect(svg).toContain("USERS");
    expect(svg).toContain("HTTPS");
    expect(svg).toContain('marker-end="url(#arrow)"');
    // Self-contained: no scripts, no external images or links (the SVG namespace URL is not a fetch).
    expect(svg).not.toMatch(/<script|<image|href=/);
    expect(svg.endsWith("</svg>")).toBe(true);
    for (const kind of ["process", "org", "timeline"] as const) {
      const s = renderDiagramSvg({ ...spec, kind, nodes: spec.nodes.map(({ id, label }) => ({ id, label })) });
      expect(s).toContain("</svg>");
    }

    expect(toMermaid(spec)).toBe(
      ['flowchart TB', '  subgraph "Users"', '    u["Users & operators"]', "  end", '  subgraph "Application"', '    p["Portal"]', "  end", '  subgraph "Data"', '    d["Database"]', "  end", '  u -->|"HTTPS"| p', "  p --> d"].join("\n"),
    );
    expect(toMermaid({ ...spec, kind: "org" }).startsWith("flowchart TD")).toBe(true);
    expect(svgDataUri("<svg/>")).toBe("data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E");
  });
});
