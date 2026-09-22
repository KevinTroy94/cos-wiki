function ExcludeUnpublished() {
  return {
    name: "ExcludeUnpublished",
    shouldPublish(_ctx, [_tree, vfile]) {
      const slug = vfile.data?.slug ?? ""
      if (slug.startsWith("Sessions/") || slug.startsWith("sessions/")) return false
      const publish = vfile.data?.frontmatter?.publish
      if (publish === false || publish === "false") return false
      return true
    },
  }
}

export default ExcludeUnpublished
