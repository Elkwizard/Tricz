import { AST } from "./ast.mjs";
import { ArrayType, FunctionType, PointerType, PrimitiveType, Type } from "./types.mjs";
import Visitor from "/G:/My Drive/Desktop/Pipelang2/visitor.mjs";


class TypeChecker extends Visitor {
    constructor() {
        super();
        this.returnType = null;
    }
    visit(node) {
        const result = node._type ??= super.visit(node);
        return result;
    }
    // type
    IntType() {
        return PrimitiveType.INT;
    }
    FixedType() {
        return PrimitiveType.FIXED;
    }
    BoolType() {
        return PrimitiveType.BOOL;
    }
    VoidType() {
        return PrimitiveType.VOID;
    }
    PointerType(ptr) {
        return new PointerType(this.visit(ptr.target));
    }
    ArrayType(arr) {
        const { length } = arr;
        if (!(length instanceof AST.Int))
            length.error(`Array length must be a constant integer`);

        return new ArrayType(this.visit(arr.element), +length.value);
    }
    FunctionType(fn) {
        return new FunctionType(
            this.visit(fn.result),
            fn.params.map(param => this.visit(param))
        );
    }
    // expressions
    Int() {
        return PrimitiveType.INT;
    }
    Fixed() {
        return PrimitiveType.FIXED;
    }
    Bool() {
        return PrimitiveType.BOOL;
    }
    Reference(node) {
        return this.visit(node._decl);
    }
    AddressOf(node) {
        return new PointerType(this.visit(node.target));
    }
    Dereference(node) {
        const ptrType = this.visit(node.target);

        if (!(ptrType instanceof PointerType))
            node.error(`Cannot dereference non-pointer type '${ptrType}'`);

        return ptrType.target;
    }
    Negate(node) {
        const type = this.visit(node.target);

        if (type !== PrimitiveType.INT && type !== PrimitiveType.FIXED)
            node.error(`Cannot negate non-numeric type '${type}'`);

        return type;
    }
    Multiply(node) {
        return this.getCommonNumericType(node.left, node.right);
    }
    Divide(node) {
        return this.getCommonNumericType(node.left, node.right);
    }
    Remainder(node) {
        return this.getCommonNumericType(node.left, node.right);
    }
    Sum(node) {
        return this.getCommonNumericType(node.left, node.right);
    }
    Cast(cast) {
        const { target, type } = cast;
        const srcType = this.visit(target);
        const dstType = this.visit(type);

        if (!srcType.convertibleTo(dstType))
            cast.error(`Cannot convert type '${srcType}' to '${dstType}'`);

        return dstType;
    }
    Subscript({ arr, index }) {
        const arrType = this.visit(arr);
        const indexType = this.visit(index);

        if (indexType !== PrimitiveType.INT)
            index.error(`Cannot subscript array with non-int type '${indexType}'`);
        
        if (arrType instanceof ArrayType)
            return arrType.element;

        if (arrType instanceof PointerType)
            return arrType.target;

        arr.error(`Cannot subscript non-array/pointer type '${arrType}'`);
    }
    Call({ fn, args }) {
        const fnType = this.visit(fn);

        if (!(fnType instanceof FunctionType))
            fn.error(`Cannot call non-function type '${fnType}'`);

        if (args.length !== fnType.params.length)
            fn.error(`Wrong number of arguments. Got ${args.length}, but ${fnType.params.length} required`);

        for (let i = 0; i < args.length; i++) {
            const argType = this.visit(args[i]);
            const paramType = fnType.params[i];

            if (!argType.convertibleTo(paramType))
                args[i].error(`Cannot pass argument of type '${argType}' to parameter of type '${paramType}' (parameter #${i + 1})`);

            argType._targetType = paramType;
        }

        return fnType.result;
    }
    Assign({ left, right }) {
        const dstType = this.visit(left);
        const srcType = this.visit(right);

        if (!srcType.convertibleTo(dstType))
            right.error(`Cannot assign type '${srcType}' to variable of type '${dstType}'`);

        right._targetType = dstType;

        return dstType;
    }
    // statements
    ExpressionStatement(stmt) {
        this.visit(stmt.value);
    }
    Block(block) {
        for (const stmt of block.stmts)
            this.visit(stmt);
    }
    // declarations
    Param(param) {
        return this.visit(param.type);
    }
    Variable(variable) {
        return this.visit(variable.type);
    }
    Function(fn) {
        fn._type = new FunctionType(
            this.visit(fn.result),
            fn.params.map(param => this.visit(param))
        );

        this.returnType = fn._type.result;

        this.visit(fn.body);

        return fn._type;
    }
    root({ decls }) {
        for (const decl of decls)
            this.visit(decl);
    }
    getArithmeticType(node) {
        const type = this.visit(node);

        if (!type.numeric || !(type instanceof PrimitiveType))
            node.error(`Cannot do arithmetic on non-numeric type '${type}'`);
        
        return type;
    }
    getCommonNumericType(a, b) {
        const aType = this.getArithmeticType(a);
        const bType = this.getArithmeticType(b);

        if (aType.equals(bType))
            return aType;

        const result = PrimitiveType.FIXED;
        aType._targetType = result;
        bType._targetType = result;

        return result;
    }
}

export default function typeCheck(root) {
    new TypeChecker().visit(root);
}