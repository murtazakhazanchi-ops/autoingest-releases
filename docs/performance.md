# Performance Rules

## Rendering

- tileMap for O(1) updates
- No querySelectorAll loops
- No re-render on scroll

---

## Thumbnails

- lazy loading
- async decoding
- cached

---

## Updates

- Use sync functions
- Avoid DOM rebuilds

---

## Constraints

- renderFileArea only on:
  - folder change
  - sort change
  - view change

---

## Ingestion Performance

- Process files sequentially or in controlled batches
- Avoid blocking main thread
- Do not scan destination repeatedly
- Cache destination file index (destFileCache)

---

## Filesystem

- Avoid repeated directory reads
- Cache directory structure where possible
- Minimize disk I/O operations

---

## Contract Safety

- Performance optimizations must not violate system contracts
- Do not skip validation for speed
- Do not bypass event.json for faster execution

---

## Scalability

- System must handle large file sets (1000+ files)
- UI must remain responsive during import
- Operations must scale linearly (O(n), not O(n²))

---

## Logging

- Logging must be lightweight
- Avoid excessive console output in loops