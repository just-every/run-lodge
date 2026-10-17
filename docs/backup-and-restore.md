# Back up and restore

One file holds your whole Lodge: every record, file and import batch.

## Back up

Stop Lodge, then export:

```sh
rer dev --stop
rer export --output exports/lodge.rer
```

Keep the file somewhere safe: it holds candidate data.

## Restore

Restore into an empty Lodge running the same release, then run setup as the
same owner:

```sh
npx -y @runeditrun/rer install just-every/run-lodge --dir lodge-restored
cd lodge-restored
rer import --input ../lodge/exports/lodge.rer --yes
rer setup --owner-email you@example.com
rer dev
```

A damaged or partial file is refused and nothing is written. To restore over a
Lodge that already holds data, export it first, then `rer reset --yes` removes
its local data before the import.

Import batches come across too, but a restored batch can be read, not resumed
or undone: undo a batch before you move if you may need to.
