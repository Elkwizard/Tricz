import { styleText } from "node:util";

export class Register {
    static id = 0;
    constructor(type, global = false, id = Register.id++) {
        this.type = type;
        this.global = global;
        this.id = id;
    }
    toString() {
        return styleText(
            this.global ? "red" : "yellow",
            `${this.type}$${this.id}`
        );
    }
    equals(other) {
        return this === other;
    }
}

export class Address {
    constructor(register) {
        this.register = register;
    }
    toString() {
        return "&" + this.register;
    }
    equals(other) {
        return  other instanceof Address &&
                other.register.equals(this.register);
    }
}

export class Constant {
    constructor(value) {
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

export class List {
    constructor(elements) {
        this.elements = elements;
    }
    toString() {
        return `${styleText("blue", "[")}${this.elements.join(", ")}${styleText("blue", "]")}`;
    }
    equals(other) {
        return  other instanceof List &&
                other.elements.length === this.elements.length &&
                other.elements.every((el, i) => el.equals(this.elements[i]));
    }
}

export class Label {
    static id = 0;
    constructor(name = "L", id = Label.id++) {
        this.name = name;
        this.id = id;
    }
    toString() {
        return styleText("green", `${this.name}${this.id}`);
    }
    equals(other) {
        return this === other;
    }
}

export class Jump {
    constructor(label) {
        this.label = label;
    }
    toString() {
        return `${styleText("magenta", "Jump")} ${this.label}`;
    }
}

export class Return {
    constructor() {

    }
    toString() {
        return `${styleText("magenta", "Return")}`;
    }
}

export class Branch {
    constructor(value, compare, label) {
        this.value = value;
        this.compare = compare;
        this.label = label;
    }
    toString() {
        return `${styleText("magenta", "Branch")} ${this.label} ${styleText("magenta", "If")} ${this.value} ${this.compare} 0`;
    }
}

export class Call {
    constructor(fn) {
        this.fn = fn;
    }
    toString() {
        return `${styleText("magenta", "Call")} ${this.fn}`;
    }
}

export class Store {
    constructor(addr, src) {
        this.addr = addr;
        this.src = src;
    }
    toString() {
        return `*${this.addr} := ${this.src}`;
    }
}

export class TAC {
    constructor(dst, src) {
        this.dst = dst;
        this.src = src;
    }
    toString() {
        return `${this.dst} := ${this.src}`;
    }
}

export class Expression {
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

export class Unary extends Expression {
    constructor(target) {
        super();
        this.target = target;
    }
}

export class Binary extends Expression {
    constructor(a, b) {
        super();
        this.a = a;
        this.b = b;
    }
}

export class Copy extends Unary { }
export class Negate extends Unary { }
export class Load extends Unary { }

export class Add extends Binary { }
export class Multiply extends Binary { }
export class Divide extends Binary { }
export class Remainder extends Binary { }