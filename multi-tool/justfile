alias ks := k8s-snap

# Snapshot all the resources in all the visible namespaces in a kube cluster. Expects KUBECONFIG env var to be set out of band. 
k8s-snap:
    ./kits/k8s-snap.sh > "./outs/$(date +%Y%m%d%H%M%S)-k8s-snap.txt"

default:
  just --list