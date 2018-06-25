set -e
gql maddsvc "dt.test03" -i "dt.test03" -s "03/model.gql" -p ckg
gql get-schema -p test03
gql mload "03/" -p test03
gql mload "03a/" -m addChilds -p test03
