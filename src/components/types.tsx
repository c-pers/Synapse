export interface FileNode {
    id: string;
    name: string;
    path: string;
    x: number;
    y: number;
    extension: string;
}

export interface GraphEdge {
    from: string;
    to: string;
    relation: string;
}