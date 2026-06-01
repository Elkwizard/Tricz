import fs from "node:fs";
import { stripVTControlCharacters } from "node:util";
import url from "node:url";
import path from "node:path";

export default function exportGraph(graph, name, code = false) {
    let result = "digraph {\n";
    if (code)
        result += "graph [fontname=monospace]\nnode [fontname=monospace shape=box]\n";
    
    const makeLabel = name => {
        if (code)
            return `"${String(name).replace(/(\r?\n)/g, "\\l")}\\l"`;

        return `"${name}"`;
    };
    for (const [node, neighbors] of graph) {
        for (const neighbor of neighbors) {
            result += `${makeLabel(node)} -> ${makeLabel(neighbor)}\n`;
        }
    }
    result += "}";
    fs.writeFileSync(
        path.join(path.dirname(url.fileURLToPath(import.meta.url)), name),
        stripVTControlCharacters(result),
        "utf-8"
    );
}