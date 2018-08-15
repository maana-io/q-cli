#
# Create a relation and some links in CKG
#
set -e

gql mload "08/Relation.json" -m addRelation -p ckg
