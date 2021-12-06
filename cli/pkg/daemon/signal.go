package daemon

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func WaitCtrlC() {
	fmt.Println("Please use `Ctrl-C` to exit this program.")

	//waiting for signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	exitChan := make(chan int)

	go checkSignal(sigChan, exitChan)

	<-exitChan
}

func checkSignal(sigChan chan os.Signal, exitChan chan int) {
	sig := <-sigChan

	switch sig {
	// kill -SIGHUP XXXX [XXXX - PID for your program]
	case syscall.SIGHUP:
		exitChan <- 0

		// kill -SIGINT XXXX or Ctrl+c  [XXXX - PID for your program]
	case syscall.SIGINT:
		exitChan <- 0

		// kill -SIGTERM XXXX [XXXX - PID for your program]
	case syscall.SIGTERM:
		fmt.Println("Signal terminte triggered.")
		exitChan <- 0

		// kill -SIGQUIT XXXX [XXXX - PID for your program]
	case syscall.SIGQUIT:
		fmt.Println("Signal quit triggered.")
		exitChan <- 0

	default:
		fmt.Println("Unknown signal.")
		exitChan <- 0
	}
}
