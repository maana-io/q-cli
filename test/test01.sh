set -e
gql maddsvc "cli.test01" -i "cli.test01" -s "01/model.gql" -p ckg
gql get-schema -p test01
gql mload 01/Rig.json -p test01 -b 1000
