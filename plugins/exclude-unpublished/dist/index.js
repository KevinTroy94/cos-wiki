function ExcludeUnpublished() {
  return {
    name: "ExcludeUnpublished",
    shouldPublish(_ctx, [_tree, vfile]) {
      const publish = vfile.data?.frontmatter?.publish
      if (publish === false || publish === "false") return false
      return true
    },
  }
}

export default ExcludeUnpublished
