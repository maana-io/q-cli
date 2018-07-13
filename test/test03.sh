set -e
gql maddsvc "cli.test03" -i "cli.test03" -s "03/model.gql" -p ckg
gql get-schema -p test03
gql mload "03/" -p test03
gql mload "03a/" -m addChilds -p test03
