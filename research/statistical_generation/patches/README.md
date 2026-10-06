# Dependency patches

No source patches are required for the locked upstream revisions with the documented GCC 14.2.0 / Boost 1.74.0 / bzip2 1.0.8 build. The initial missing-bzip2 link failure was resolved by building the official prerequisite and enabling Boost iostreams support, without modifying Moses source or algorithms.

Any future patch must be a minimal compiler/build compatibility change against an exact locked upstream commit, with the reason and smoke-test effect documented. Alignment, phrase extraction/scoring, n-gram estimation, and decoding remain upstream implementations. The build script rejects unexpected tracked source modifications and records applied patch hashes.
