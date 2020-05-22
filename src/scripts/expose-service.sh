#!/bin/sh

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' 

serviceName=$SERVICE_ID
port=$PORT
max_attempts=100
interval=5
HOME=`eval echo ~$USER`
KUBECONFIG=$HOME/.kube/config


function __is_ingress_ready() {
  [[ "$(kubectl --kubeconfig=$KUBECONFIG get service "$serviceName-lb" -o 'jsonpath={.status.loadBalancer.ingress[].ip}')" != '' ]]
}  

printf "===========================================\n"
printf "${GREEN}Exposing your service...${NC}\n"
kubectl --kubeconfig="$KUBECONFIG" expose deployment $serviceName  --type=LoadBalancer --port=$port --target-port=$port --name  $serviceName-lb


printf "Waiting for the Load Balancer to start. (${BLUE}This might take several minutes.${NC})\n"
printf "===========================================\n"

deployment_ready_attempt_counter=0
until __is_ingress_ready; do
    if [ ${deployment_ready_attempt_counter} -eq ${max_attempts} ];then
      echo "Max attempts reached"
      exit 1
    fi

    printf '.'
    attempt_counter=$(($attempt_counter+1))
    sleep $interval
done

ip=`kubectl --kubeconfig="$KUBECONFIG" get service $serviceName-lb -o json -o 'jsonpath={.status.loadBalancer.ingress[].ip}'`  

printf "\n===========================================\n"
printf "The external IP address for ${BLUE}$serviceName:$version${NC} is:\n\n ${GREEN}$ip${NC}\n\n"
printf "The URL for your GraphQL endpoint is\n\n  ${GREEN}http://$ip:$port\n\n${NC}" 