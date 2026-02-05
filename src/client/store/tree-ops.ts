import type { FileNode } from "./types.js";

/** Insert a node at the correct sorted position in the tree */
export function treeAddNode(
  tree: FileNode[],
  path: string,
  nodeType: "file" | "directory"
): FileNode[] {
  const parts = path.split("/");

  if (parts.length === 1) {
    // Insert at this level
    const name = parts[0];
    // Don't add if already exists
    if (tree.some((n) => n.name === name)) return tree;

    const newNode: FileNode = { name, path, type: nodeType };
    if (nodeType === "directory") newNode.children = [];

    const result = [...tree, newNode];
    result.sort((a, b) => {
      // Directories first, then alphabetical
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  }

  // Need to descend into a subdirectory
  const dirName = parts[0];
  return tree.map((node) => {
    if (node.name === dirName && node.type === "directory" && node.children) {
      return {
        ...node,
        children: treeAddNode(node.children, parts.slice(1).join("/"), nodeType),
      };
    }
    return node;
  });
}

/** Remove a node by path */
export function treeRemoveNode(tree: FileNode[], path: string): FileNode[] {
  const parts = path.split("/");

  if (parts.length === 1) {
    return tree.filter((n) => n.name !== parts[0]);
  }

  const dirName = parts[0];
  return tree.map((node) => {
    if (node.name === dirName && node.type === "directory" && node.children) {
      return {
        ...node,
        children: treeRemoveNode(node.children, parts.slice(1).join("/")),
      };
    }
    return node;
  });
}

/** Rename/move a node */
export function treeRenameNode(
  tree: FileNode[],
  from: string,
  to: string
): FileNode[] {
  // Find the node being renamed
  const node = findNode(tree, from);
  if (!node) return tree;

  // Remove from old location, add to new
  const removed = treeRemoveNode(tree, from);
  return treeAddNode(removed, to, node.type);
}

function findNode(tree: FileNode[], path: string): FileNode | null {
  const parts = path.split("/");

  for (const node of tree) {
    if (parts.length === 1 && node.name === parts[0]) return node;
    if (
      node.name === parts[0] &&
      node.type === "directory" &&
      node.children
    ) {
      const found = findNode(node.children, parts.slice(1).join("/"));
      if (found) return found;
    }
  }
  return null;
}
