# Vendored npm tarballs

`clsx` and `tailwind-merge` (both dependency-free, MIT) are installed from these
tarballs via `file:vendor/npm/*.tgz` because the npm registry is unreachable
from this environment (registry DNS resolves IPv6-only; npm fails with
`ENETUNREACH` while plain HTTPS works, so the tarballs were fetched with curl).

To switch back to registry versions when the network allows:

```sh
npm install clsx@^2.1.1 tailwind-merge@^3.6.0
rm -rf vendor/npm  # then remove this README with it
```
