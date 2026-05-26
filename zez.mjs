export class Expression {
    replace(mapping) {
        return this;
    }
    equals(other) {
        return other instanceof this.constructor;
    }
}

export class Literal extends Expression {
    constructor(value) {
        super();
        this.value = value;
    }
    equals(other) {
        return super.equals(other) && this.value === other.value;
    }
    toString() {
        return String(this.value);
    }
}

export class Placeholder extends Expression {
    constructor(key) {
        super();
        this.key = key;
    }
    equals(other) {
        return super.equals(other) && this.key === other.key;
    }
    replace(mapping) {
        if (mapping.has(this.key))
            return mapping.get(this.key);
        return this;
    }
    toString() {
        return `"${this.key}"`;
    }
}

export class Operator extends Expression {
    constructor(target) {
        super();
        this.target = target;
    }
    equals(other) {
        return super.equals(other) && this.target.equals(other.target);
    }
    replace(mapping) {
        this.target = this.target.replace(mapping);
        return this;
    }
}

export class Negate extends Operator {
    toString() {
        return `-${this.target}`;
    }
}

export class Sign extends Operator {
    toString() {
        return `(${this.target})`;
    }
}

export class Deref extends Operator {
    toString() {
        return `[${this.target}]`;
    }
}

export class Instruction {
    constructor(dst, src) {
        this.dst = dst;
        this.src = src;
    }
    replace(mapping) {
        this.dst = this.dst.replace(mapping);
        this.src = this.src.replace(mapping);
    }
    equals(other) {
        return  other instanceof Instruction &&
                this.dst.equals(other.dst) &&
                this.src.equals(other.src);
    }
    toString() {
        return `${this.dst} ${this.src}`;
    }
}

export class Break {
    replace(mapping) { }
    equals(other) {
        return other instanceof Break;
    }
    toString() {
        return "EOL";
    }
}

export const ZERO = new Literal(0);

export const deref = a => new Deref(a);
export const literal = a => new Literal(a);
export const sign = a => new Sign(a);
export const negate = a => {
    if (a instanceof Negate)
        return a.target;
    
    if (a instanceof Literal)
        return new Literal(-a.value);

    return new Negate(a);
};
export const add = (a, b) => {
    return addLiteral(a, new Deref(b));
};
export const addLiteral = (a, b) => {
    return [new Instruction(a, b)];
};
export const set = (a, b) => {
    return setLiteral(a, new Deref(b));
};
export const setLiteral = (a, b) => {
    return [
        new Instruction(a, new Negate(new Deref(a))),
        new Instruction(a, b)
    ];
};
export const jumpOffset = offsetExp => {
    return [
        new Instruction(ZERO, offsetExp),
        new Instruction(ZERO, new Literal(-1)),
        new Break()
    ];
};
export const jumpOffsetLiteral = offset => {
    return [
        new Instruction(ZERO, new Literal(offset)),
        new Break()
    ];
};
export const jumpLiteral = lineNumber => {
    return [
        ...set(ZERO, new Literal(lineNumber - 1)),
        new Break()
    ];
};
export const jump = lineNumberExp => {
    return [
        ...set(ZERO, lineNumberExp),
        new Instruction(ZERO, new Literal(-1)),
        new Break()
    ];
};
export const stringify = instructions => {
    const lines = [];
    let line = [];
    for (const instruction of instructions) {
        if (instruction instanceof Break) {
            lines.push(line);
            line = [];
        } else {
            line.push(instruction);
        }
    }
    if (line.length) lines.push(line);
    
    return lines.map(line => line.join(" ")).join("\n");
};