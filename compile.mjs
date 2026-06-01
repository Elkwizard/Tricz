import { analyze } from "./analyze.mjs";
import clean from "./clean.mjs";
import codegen from "./codegen.mjs";
import config from "./config.mjs";
import { parse } from "./grammar/parse.mjs";
import lower from "./lower.mjs";
import lowerResolved from "./lowerResolved.mjs";
import optimize from "./optimize.mjs";
import optimizeZEZ from "./optimizeZEZ.mjs";
import prettyPrint from "./pretty.mjs";
import resolveReferences from "./resolve.mjs";
import toIR from "./toIR.mjs";
import typeCheck from "./typeCheck.mjs";
import { stringify } from "./zez.mjs";

const logPhase = (phase, data) => {
    if (!config.log.phases?.includes(phase))
        return;

    console.log(`=== ${phase.toUpperCase()} ===`);

    if (Array.isArray(data)) {
        console.log(ir.map(fn => fn.join("\n")).join("\n\n"));
    } else {
        console.log(prettyPrint(data));
    }
};

export default function compile(root, config) {
    root = lower(root);
    logPhase("lowered", root);
    root = resolveReferences(root);
    root = lowerResolved(root);
    logPhase("resolved", root);
    typeCheck(root);
    logPhase("typed", root);

    const ir = toIR(root, config);
    logPhase("ir", ir);
    const analysis = analyze(ir);
    const optimized = ir.map(fn => optimize(fn, analysis));
    logPhase("optimized", optimized);
    // return;
    let zez = codegen(optimized);
    console.log(zez.length);
    zez = optimizeZEZ(zez);
    console.log(zez.length);
    return stringify(zez);
}