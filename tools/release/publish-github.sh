#!/usr/bin/env bash
# Run by the official tag workflow after both signed desktop packages pass.
set -euo pipefail

: "${GITHUB_REPOSITORY:?}" "${GITHUB_REF_NAME:?}" "${GITHUB_SHA:?}" "${RUNNER_TEMP:?}"
tag="$GITHUB_REF_NAME"
[[ "${GITHUB_REF_TYPE:-}" == tag ]]
[[ "$tag" == "v$(tr -d '[:space:]' < VERSION)" ]]
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]]

verify_remote_tag() {
  local ref="refs/tags/$tag" remote_commit
  remote_commit="$(git ls-remote --exit-code origin "$ref" "$ref^{}" |
    awk -v ref="$ref" '$2 == ref {tag=$1} $2 == (ref "^{}") {commit=$1} END {print (commit ? commit : tag)}')"
  [[ "$remote_commit" == "$GITHUB_SHA" ]]
}
verify_remote_tag

work="$(mktemp -d "$RUNNER_TEMP/pinkie-release-stage.XXXXXX")"
validator=tools/release/release_assets.py
python3 "$validator" plan "$tag" "$GITHUB_SHA" dist mirror/latest.json > "$work/plan.json"
gh release list --repo "$GITHUB_REPOSITORY" --exclude-drafts --exclude-pre-releases \
  --limit 100 --json tagName > "$work/published.json"
python3 "$validator" not-older "$tag" "$work/published.json"

fields=tagName,isDraft,isPrerelease,assets
view() {
  gh release view "$tag" --repo "$GITHUB_REPOSITORY" --json "$fields" > "$work/remote.json"
}
if ! view; then
  gh release create "$tag" --repo "$GITHUB_REPOSITORY" --verify-tag --draft \
    --title "$tag" --notes-file release-body.md
  view
fi
if jq -e '.isDraft == true and .isPrerelease == false' "$work/remote.json" > /dev/null; then
  jq -r '.[] | .path' "$work/plan.json" > "$work/paths"
  mapfile -t assets < "$work/paths"
  gh release upload "$tag" "${assets[@]}" --repo "$GITHUB_REPOSITORY" --clobber
  view
fi
# Re-running may refresh a draft, but an already public release is only read
# here. Never replace its packages. Always check the signed index itself too.
python3 "$validator" verify-upload "$tag" "$work/plan.json" "$work/remote.json"
verify_remote_tag
gh release edit "$tag" --repo "$GITHUB_REPOSITORY" --verify-tag --draft=false --latest

for _ in {1..12}; do
  latest="$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" \
    -H 'Cache-Control: no-cache' --jq '.tag_name' || true)"
  if [[ "$latest" == "$tag" ]]; then
    echo "$tag is public and is the official latest update."
    exit 0
  fi
  sleep 3
done
echo "GitHub's latest update pointer has not resolved to $tag." >&2
exit 1
