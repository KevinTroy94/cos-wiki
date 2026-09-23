import { visit, SKIP } from "unist-util-visit"

function isDMSpoiler(node) {
  // Match plain blockquote: first paragraph's first text starts with [!dmspoiler]
  if (node.type === "blockquote") {
    const firstChild = node.children?.[0]
    const firstText = firstChild?.children?.[0]
    const value = firstText?.value ?? firstText?.children?.[0]?.value ?? ""
    if (/^\[!dmspoiler\]/i.test(value)) return true
  }
  // Match after obsidian-flavored-markdown transforms it into a callout node
  if (node.type === "callout" || node.data?.calloutType) {
    const calloutType = node.data?.calloutType ?? node.calloutType ?? ""
    if (/^dmspoiler$/i.test(calloutType)) return true
  }
  // Match via hProperties class (rehype level)
  const classes = node.data?.hProperties?.className ?? []
  if (Array.isArray(classes) && classes.some(c => /dmspoiler/i.test(c))) return true
  return false
}

function RemoveDMSpoilers() {
  return {
    name: "RemoveDMSpoilers",
    markdownPlugins() {
      return [
        () => (tree) => {
          visit(tree, (node, index, parent) => {
            if ((node.type === "blockquote" || node.type === "callout" || node.data?.calloutType) && parent && index != null) {
              console.log("[dmspoiler] node:", JSON.stringify({ type: node.type, calloutType: node.data?.calloutType, hName: node.data?.hName, hProperties: node.data?.hProperties, firstChildType: node.children?.[0]?.type, firstTextValue: node.children?.[0]?.children?.[0]?.value }))
            }
            if (isDMSpoiler(node) && parent && index != null) {
              parent.children.splice(index, 1)
              return [SKIP, index]
            }
          })
        },
      ]
    },
  }
}

export default RemoveDMSpoilers
