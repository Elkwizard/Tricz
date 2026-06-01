export class DependencyGraph {
    constructor() {
        this.nodeToDependencies = new Map();
        this.nodeToDependents = new Map();
    }
    get nodes() {
        return new Set([
            ...this.nodeToDependents.keys(),
            ...this.nodeToDependencies.keys()
        ]);
    }
    getAllDependencies(node) {
        return new Set(breadth(new Set([node]), this.nodeToDependencies, true));
    }
    addDependency(dependent, dependency) {
        if (!this.nodeToDependencies.has(dependent))
            this.nodeToDependencies.set(dependent, new Set());
        this.nodeToDependencies.get(dependent).add(dependency);

        if (!this.nodeToDependents.has(dependency))
            this.nodeToDependents.set(dependency, new Set());
        this.nodeToDependents.get(dependency).add(dependent);
    }
    clear() {
        this.nodeToDependencies.clear();
        this.nodeToDependents.clear();
    }
    delete(node) {
        const dependencies = [...this.getDependencies(node)];
        const dependents = [...this.getDependents(node)];

        for (const dependency of dependencies)
            this.nodeToDependents.get(dependency).delete(node);

        for (const dependent of dependents)
            this.nodeToDependencies.get(dependent).delete(node);

        this.nodeToDependencies.delete(node);
        this.nodeToDependents.delete(node);
    }
    getDependents(node) {
        return this.nodeToDependents.get(node) ?? new Set();
    }
    getDependencies(node) {
        return this.nodeToDependencies.get(node) ?? new Set();
    }
    toString() {
        return [
            ...[...this.nodeToDependencies]
                .flatMap(([node, dependencies]) => [...dependencies].map(
                    dependency => `${node} -> ${dependency}`
                ))
        ].map(line => `  ${line}`).join("\n");
    }
}

export function reverseGraph(adjList) {
    const revAdjList = new Map();

    for (const [node, neighbors] of adjList) {
        for (const neighbor of neighbors) {
            if (!revAdjList.has(neighbor)) revAdjList.set(neighbor, new Set());
            revAdjList.get(neighbor).add(node);
        }
    }

    return revAdjList;
}

export function* breadth(toExplore, adjList, inclusive) {
    const found = new Set();

    if (inclusive) {
        for (const root of toExplore) {
            found.add(root);
            yield root;
        }
    }

    while (toExplore.size) {
        const toExploreNext = new Set();
        for (const node of toExplore) {
            if (!adjList.has(node)) continue;

            for (const neighbor of adjList.get(node)) {
                if (!found.has(neighbor)) {
                    found.add(neighbor);
                    toExploreNext.add(neighbor);
                    yield neighbor;
                }
            }
        }
        toExplore = toExploreNext;
    }
}