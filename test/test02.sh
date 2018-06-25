set -e
gql maddsvc "dt.test02" -i "dt.test02" -s "02/model.gql" -p ckg
gql get-schema -p test02
gql mload 02/ListTest.json -p test02
