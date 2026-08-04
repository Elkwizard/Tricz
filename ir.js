import { stripVTControlCharacters, styleText } from "node:util";

export class Operand {
    get size() {
        return 1;
    }
    /**
     * @returns {Address[]}
     */
    get addresses() {
        return [];
    }
    /**
     * @returns {Register[]}
     */
    get registers() {
        return [];
    }
    /**
     * @returns {Label[]}
     */
    get labels() {
        return [];
    }
}

export class Register extends Operand {
    static id = 0;
    constructor(type, global = false, name = null, id = Register.id++) {
        super();
        this.type = type;
        this.global = global;
        this.name = stripVTControlCharacters(name);
        this.id = id;
    }
    get size() {
        return this.type.size;
    }
    get registers() {
        return [this];
    }
    toString() {
        return styleText(
            this.global ? "red" : "yellow",
            `${this.type}$${this.name ?? ""}${this.id}`
        );
    }
    equals(other) {
        return this === other;
    }
}

export class Address extends Operand {
    /**
     * @param {Register} register 
     */
    constructor(register) {
        super();
        this.register = register;
    }
    get addresses() {
        return [this];
    }
    get registers() {
        return this.register.registers;
    }
    toString() {
        return "&" + this.register;
    }
    equals(other) {
        return  other instanceof Address &&
                other.register.equals(this.register);
    }
}

export class Constant extends Operand {
    /**
     * @param {number} value 
     */
    constructor(value) {
        super();
        this.value = value;
    }
    toString() {
        return styleText("blue", `${this.value}`);
    }
    equals(other) {
        return  other instanceof Constant &&
                other.value === this.value;
    }
}

export class Tuple extends Operand {
    /**
     * @param {Operand[]} elements 
     */
    constructor(elements) {
        super();
        this.elements = elements;
    }
    get size() {
        return this.elements
            .map(el => el.size)
            .reduce((a, b) => a + b, 0);
    }
    get registers() {
        return this.elements.flatMap(el => el.registers);
    }
    get addresses() {
        return this.elements.flatMap(el => el.addresses);
    }
    get labels() {
        return this.elements.flatMap(el => el.labels);
    }
    toString() {
        const content = this.elements.join(", ");
        return `${styleText("blue", "[")}${content.length > 100 ? "..." : content}${styleText("blue", "]")}`;
    }
    equals(other) {
        return  other instanceof Tuple &&
                other.elements.length === this.elements.length &&
                other.elements.every((el, i) => el.equals(this.elements[i]));
    }
}

export class Label extends Operand {
    static id = 0;
    constructor(global = false, name = "L", id = Label.id++) {
        super();
        this.global = global;
        this.name = name;
        this.id = id;
    }
    get labels() {
        return [this];
    }
    toString() {
        return styleText(this.global ? "cyan" : "green", `${this.name}${this.id}`);
    }
    equals(other) {
        return this === other;
    }
}

export class Statement {
    constructor() {

    }
    get registers() {
        return this.uses.flatMap(value => value.registers);
    }
    get addresses() {
        return this.uses.flatMap(value => value.addresses);
    }
    get labels() {
        return this.uses.flatMap(value => value.labels);
    }
    get uses() {
        return [...this.reads, ...this.writes];
    }
    /**
     * @returns {Operand[]}
     */
    get reads() {
        return [];
    }
    /**
     * @returns {Operand[]}
     */
    get writes() {
        return [];
    }
}

export class LabelDecl extends Statement {
    constructor(label) {
        super();
        this.label = label;
    }
    toString() {
        return `${this.label}:`;
    }
}

export class Branch extends Statement { }

export class TargetBranch extends Branch {
    constructor(label) {
        super();
        this.label = label;
    }
}

export class Jump extends TargetBranch {
    get reads() {
        return [this.label];
    }
    toString() {
        return `${styleText("magenta", "Jump")} ${this.label}`;
    }
}

export class CompareJump extends TargetBranch {
    constructor(value, compare, label) {
        super(label);
        this.value = value;
        this.compare = compare;
    }
    get reads() {
        return [this.value, this.label];
    }
    toString() {
        return `${styleText("magenta", "Jump")} ${this.label} ${styleText("magenta", "If")} ${this.value} ${this.compare} 0`;
    }
}

export class Return extends Branch {
    constructor() {
        super();
    }
    toString() {
        return `${styleText("magenta", "Return")}`;
    }
}

export class Call extends Statement {
    constructor(fn) {
        super();
        this.fn = fn;
    }
    get reads() {
        return [this.fn];
    }
    toString() {
        return `${styleText("magenta", "Call")} ${this.fn}`;
    }
}

export class RecCall extends Statement {
    constructor(fn) {
        super();
        this.fn = fn;
    }
    get reads() {
        return [this.fn];
    }
    toString() {
        return `${styleText("magenta", "Recursive Call")} ${this.fn}`;
    }
}

export class StackOperation extends Statement {
    constructor(value) {
        super();
        this.value = value;
    }
    toString() {
        return `${styleText("magenta", this.constructor.name)} ${this.value}`;
    }
}

export class Push extends StackOperation {
    get reads() {
        return [this.value];
    }
}
export class Pop extends StackOperation {
    get writes() {
        return [this.value];
    }
}

export class Store extends Statement {
    constructor(addr, src) {
        super();
        this.addr = addr;
        this.src = src;
    }
    get reads() {
        return [this.addr, this.src];
    }
    toString() {
        return `*${this.addr} := ${this.src}`;
    }
}

export class TAC extends Statement {
    constructor(dst, src) {
        super();
        this.dst = dst;
        this.src = src;
    }
    get reads() {
        return this.src.reads;
    }
    get writes() {
        return [this.dst];
    }
    toString() {
        return `${this.dst} := ${this.src}`;
    }
}

export class Operator {
    toString() {
        return `${
            styleText("magenta", this.constructor.name)
        } ${
            Object.values(this).join(", ")
        }`;
    }
    into(dst) {
        return new TAC(dst, this);
    }
}

export class Unary extends Operator {
    constructor(target) {
        super();
        this.target = target;
    }
    get reads() {
        return [this.target];
    }
}

export class Binary extends Operator {
    constructor(a, b) {
        super();
        this.a = a;
        this.b = b;
    }
    get reads() {
        return [this.a, this.b];
    }
}

export class Copy extends Unary { }
export class Negate extends Unary { }
export class Load extends Unary { }
export class Protect extends Unary { }

export class Add extends Binary { }
export class Multiply extends Binary { }
export class Divide extends Binary { }
export class Remainder extends Binary { }