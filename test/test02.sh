set -e
gql maddsvc "cli.test02" -i "cli.test02" -s "02/model.gql" -p ckg
gql get-schema -p test02
gql mload 02/ListTest.json -p test02
