-- Expand family kinship types for the genealogical graph.
ALTER TYPE "MemberRelationType" ADD VALUE IF NOT EXISTS 'sibling';
ALTER TYPE "MemberRelationType" ADD VALUE IF NOT EXISTS 'grandparent';
ALTER TYPE "MemberRelationType" ADD VALUE IF NOT EXISTS 'step_parent';
ALTER TYPE "MemberRelationType" ADD VALUE IF NOT EXISTS 'parent_in_law';
ALTER TYPE "MemberRelationType" ADD VALUE IF NOT EXISTS 'uncle';
