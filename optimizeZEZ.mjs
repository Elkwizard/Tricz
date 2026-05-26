import { Break, Deref, Instruction, Literal, Negate, Sign, ZERO } from "./zez.mjs";

const removeNullAdds = zez => zez.filter(inst => {
    return !(inst.src instanceof Literal && inst.src.value === 0);
});

const collapseSimpleAdds = zez => {
    const isSimpleAdd = inst => {
        return  inst instanceof Instruction &&
                inst.dst instanceof Literal &&
                inst.src instanceof Literal;
    }
    const result = [];
    for (const inst of zez) {
        const last = result.at(-1);
        
        if (
            isSimpleAdd(last) &&
            isSimpleAdd(inst) &&
            last.dst.value === inst.dst.value
        ) {
            result[result.length - 1] = new Instruction(
                last.dst,
                new Literal(last.src.value + inst.src.value)
            );
        } else {
            result.push(inst);
        }
    }

    return result;
};

const padEmptyLines = zez => {
    const result = [];
    for (const inst of zez) {
        if (inst instanceof Break && result.at(-1) instanceof Break)
            result.push(new Instruction(ZERO, ZERO));
        result.push(inst);
    }
    return result;
};

/**
 * @param {(Instruction | Break)[]} zez 
 */
export default function optimizeZEZ(zez) {
    zez = collapseSimpleAdds(zez);
    zez = removeNullAdds(zez);
    zez = padEmptyLines(zez);
    return zez;
}