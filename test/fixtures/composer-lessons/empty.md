# Empty lessons fixture — no L-NNN headers at all.

This file exists to test the edge case where the lessons file is present
but contains zero `## L-NNN` entries. The parser should return [] without
warning.
