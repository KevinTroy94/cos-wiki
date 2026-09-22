import { visit, SKIP } from "unist-util-visit"

function isDMSpoiler(node) {
  if (node.type !== "blockquote") return false
  const firstChild = node.children?.[0]
  if (!firstChild) return false
  const firstText = firstChild.children?.[0]
  if (!firstText) return false
  const value = firstText.value ?? firstText.children?.[0]?.value ?? ""
  return /^\[!dmspoiler\]/i.test(value)
}

function RemoveDMSpoilers() {
  return {
    name: "RemoveDMSpoilers",
    markdownPlugins() {
      return [
        () => (tree) => {
          visit(tree, "blockquote", (node, index, parent) => {
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
