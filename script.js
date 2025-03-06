import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  setPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getDatabase, ref, set, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-database.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC2BVISsDKOA7IGS-9TXfL6HIKDcxF5w1k",
  authDomain: "project-manager-3-prod.firebaseapp.com",
  databaseURL: "https://project-manager-3-prod-default-rtdb.firebaseio.com",
  projectId: "project-manager-3-prod",
  storageBucket: "project-manager-3-prod.firebasestorage.app",
  messagingSenderId: "943851094602",
  appId: "1:943851094602:web:14132a5b2ab15e26061cb3",
  measurementId: "G-9J2N6L5MK8"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);

// Set up authentication persistence
const setupPersistence = async () => {
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch (e) {
    console.log("Falling back to session persistence");
    try {
      await setPersistence(auth, browserSessionPersistence);
    } catch (e) {
      console.error("Could not set up persistence:", e);
    }
  }
};
setupPersistence();

// Task class for task management
class Task {
  constructor(id, name, completed = false, order = 0, additionalInfo = '') {
    this.id = id;
    this.name = name;
    this.completed = completed;
    this.order = order;
    this.additionalInfo = additionalInfo;
  }
}

// Main App
const App = (() => {
  // State variables
  let tasks = [];
  let currentUser = null;
  let currentDate = new Date();
  let sortableInstance = null;
  const MIN_TASKS = 3;
  const MAX_TASKS = 5;
  
  // DOM Elements
  const signInButton = document.getElementById('sign-in-button');
  const signOutButton = document.getElementById('sign-out-button');
  const userMenu = document.getElementById('user-menu');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');
  const addTaskButton = document.getElementById('add-task-button');
  const prevDayButton = document.getElementById('prev-day-button');
  const nextDayButton = document.getElementById('next-day-button');
  const todayButton = document.getElementById('today-button');
  const currentDateDisplay = document.getElementById('current-date');
  const emptyTasksMessage = document.getElementById('empty-tasks-message');
  const tasksContainer = document.getElementById('tasks-container');
  const appContainer = document.querySelector('.app-container');
  const taskDetailModal = document.getElementById('task-detail-modal');
  const detailTaskName = document.getElementById('detail-task-name');
  const taskAdditionalInfo = document.getElementById('task-additional-info');
  const saveTaskDetailsButton = document.getElementById('save-task-details-button');
  const taskDetailModalCloseButton = taskDetailModal.querySelector('.close-button');
  
  // Track current task being edited
  let currentTaskId = null;
  let longPressTimer = null;
  const LONG_PRESS_DURATION = 500; // ms
  
  // Helper functions for date handling
  const formatDate = (date) => {
    const options = { weekday: 'long', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  };
  
  const getDateKey = (date) => {
    return date.toISOString().split('T')[0];
  };
  
  const getTodayStr = () => getDateKey(new Date());
  
  const isToday = (dateToCheck) => {
    return getDateKey(dateToCheck) === getDateKey(new Date());
  };
  
  // Date navigation
  const changeDate = (days) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + days);
    setCurrentDate(newDate);
  };
  
  const setCurrentDate = (date) => {
    savePendingChanges();
    currentDate = date;
    updateDateDisplay();
    loadTasks();
  };
  
  const updateDateDisplay = () => {
    const isCurrentDateToday = isToday(currentDate);
    currentDateDisplay.textContent = isCurrentDateToday ? 'Today' : formatDate(currentDate);
    currentDateDisplay.classList.toggle('is-today', isCurrentDateToday);
    
    // Hide or show the "Go to Today" button based on whether the current date is today
    todayButton.style.display = isCurrentDateToday ? 'none' : 'block';
  };
  
  // Initialize the app
  const init = () => {
    // Set up auth state listener
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      updateAuthUI();
      loadTasks();
    });
    
    // Set up event listeners
    signInButton.addEventListener('click', handleAuth);
    signOutButton.addEventListener('click', handleSignOut);
    addTaskButton.addEventListener('click', addNewTask);
    prevDayButton.addEventListener('click', () => changeDate(-1));
    nextDayButton.addEventListener('click', () => changeDate(1));
    todayButton.addEventListener('click', () => setCurrentDate(new Date()));
    
    // Set up task detail modal event listeners
    taskDetailModalCloseButton.addEventListener('click', closeTaskDetailModal);
    saveTaskDetailsButton.addEventListener('click', saveTaskDetails);
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
      if (e.target === taskDetailModal) {
        closeTaskDetailModal();
      }
    });
    
    // Initialize with today's date
    updateDateDisplay();

    // Add viewport scaling functionality
    setupViewportScaling();
    setupTouchInteractions();
  };
  
  // Add scaling functionality based on viewport height
  const setupViewportScaling = () => {
    // Set initial scale
    updateViewportScale();
    
    // Update scale on window resize
    window.addEventListener('resize', updateViewportScale);
    
    // Update scale when tasks change (which might affect content height)
    const mutationObserver = new MutationObserver(updateViewportScale);
    mutationObserver.observe(tasksContainer, { 
      childList: true, 
      subtree: true,
      attributes: true
    });
  };
  
  // Calculate and apply the viewport scale
  const updateViewportScale = () => {
    // Get the content height (the natural height of the app container)
    const contentHeight = appContainer.scrollHeight;
    
    // Get the available viewport height
    const viewportHeight = window.innerHeight;
    
    // Set a base padding to account for browser UI and provide some margin
    const basePadding = 20; 
    
    // Calculate scale factor
    let scaleFactor = 1; // Default scale (no scaling)
    
    // Only scale down if content is taller than viewport
    if (contentHeight > viewportHeight - basePadding) {
      scaleFactor = (viewportHeight - basePadding) / contentHeight;
      // Remove the minimum scale limit to allow unlimited shrinking
      // scaleFactor = Math.max(scaleFactor, 0.5); -- removed this line
    }
    
    // Apply the scale factor to the root element as a CSS variable
    document.documentElement.style.setProperty('--scale-factor', scaleFactor);
    document.documentElement.style.setProperty('--content-height', `${contentHeight}px`);
    
    // Adjust body height to prevent scrolling when scaled
    if (scaleFactor < 1) {
      document.body.style.height = `${viewportHeight}px`;
      document.body.style.overflowY = 'hidden';
    } else {
      document.body.style.height = '';
      document.body.style.overflowY = '';
    }
  };
  
  // Add mobile touch interactions
  const setupTouchInteractions = () => {
    // Ensure task inputs are easy to focus on mobile
    document.addEventListener('touchstart', function(e) {
      if (e.target.classList.contains('task-text') || 
          e.target.parentElement.classList.contains('task-text')) {
        const input = e.target.tagName === 'INPUT' ? e.target : e.target.querySelector('input');
        if (input) {
          input.readOnly = false;
          // Small delay to ensure the tap registers before focusing
          setTimeout(() => input.focus(), 10);
        }
      }
    }, false);
  };
  
  const updateAuthUI = () => {
    if (currentUser) {
      signInButton.classList.add('hidden');
      userMenu.classList.remove('hidden');
      userAvatar.src = currentUser.photoURL;
      userName.textContent = currentUser.displayName;
    } else {
      signInButton.classList.remove('hidden');
      userMenu.classList.add('hidden');
    }
  };
  
  const clearUI = () => {
    tasks = [];
    renderTasks();
  };
  
  const handleAuth = async () => {
    try {
      // Save local tasks before signing in
      const localTasks = tasks.length > 0 ? [...tasks] : null;
      const currentDateKey = getDateKey(currentDate);
      
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });
      await signInWithPopup(auth, provider);
      
      // If we had local tasks, check if we should migrate them
      if (localTasks && localTasks.length > 0) {
        const userDateKey = getDateKey(currentDate);
        const tasksRef = ref(database, `users/${auth.currentUser.uid}/tasks/${userDateKey}`);
        const snapshot = await get(tasksRef);
        
        // Only migrate if the user doesn't have tasks for this date
        if (!snapshot.exists()) {
          await set(tasksRef, localTasks.reduce((acc, task) => {
            acc[task.id] = task;
            return acc;
          }, {}));
        }
      }
    } catch (error) {
      console.error("Sign in error:", error);
      alert("Sign in failed. Please try again.");
    }
  };
  
  const handleSignOut = async () => {
    try {
      // Save any pending changes before signing out
      savePendingChanges();
      await signOut(auth);
      // After sign out, load tasks from local storage
      loadTasks();
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };
  
  // Save any pending changes before performing important actions
  const savePendingChanges = () => {
    if (tasks.length > 0) {
      saveTasks();
    }
  };
  
  // Local storage helpers
  const LOCAL_STORAGE_PREFIX = 'threefive_';
  
  const saveTasksToLocalStorage = (dateKey, tasksData) => {
    try {
      localStorage.setItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`, JSON.stringify(tasksData));
      return true;
    } catch (error) {
      console.error("Error saving to localStorage:", error);
      return false;
    }
  };
  
  const loadTasksFromLocalStorage = (dateKey) => {
    try {
      const data = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}${dateKey}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error("Error loading from localStorage:", error);
      return null;
    }
  };
  
  // Tasks CRUD operations
  const loadTasks = () => {
    const dateKey = getDateKey(currentDate);
    
    if (currentUser) {
      // Load from Firebase if user is logged in
      const tasksRef = ref(database, `users/${currentUser.uid}/tasks/${dateKey}`);
      
      get(tasksRef).then((snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.val();
          tasks = Object.values(data)
            .map(t => new Task(t.id, t.name, t.completed, t.order, t.additionalInfo || ''))
            .sort((a, b) => a.order - b.order);
          
          // If we have less than MIN_TASKS, add blank ones to reach minimum
          if (tasks.length < MIN_TASKS) {
            const additionalTasks = MIN_TASKS - tasks.length;
            for (let i = 0; i < additionalTasks; i++) {
              const id = `default-${Date.now()}-${i}`;
              tasks.push(new Task(id, '', false, tasks.length));
            }
            saveTasks();
          }
        } else {
          // Create default blank tasks if no tasks exist for today
          createDefaultTasks();
        }
        
        renderTasks();
        setupDragAndDrop();
        updateAddButtonVisibility();
        
        // Show/hide empty state message
        emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
      }).catch(error => {
        console.error("Error loading tasks from Firebase:", error);
      });
    } else {
      // Load from localStorage if no user is logged in
      const storedTasks = loadTasksFromLocalStorage(dateKey);
      
      if (storedTasks) {
        tasks = Object.values(storedTasks)
          .map(t => new Task(t.id, t.name, t.completed, t.order, t.additionalInfo || ''))
          .sort((a, b) => a.order - b.order);
        
        // Ensure minimum tasks
        if (tasks.length < MIN_TASKS) {
          const additionalTasks = MIN_TASKS - tasks.length;
          for (let i = 0; i < additionalTasks; i++) {
            const id = `default-${Date.now()}-${i}`;
            tasks.push(new Task(id, '', false, tasks.length));
          }
          saveTasks();
        }
      } else {
        // Create default blank tasks if no tasks exist
        createDefaultTasks();
      }
      
      renderTasks();
      setupDragAndDrop();
      updateAddButtonVisibility();
      
      // Show/hide empty state message
      emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
    }
  };
  
  const createDefaultTasks = () => {
    tasks = [];
    // Add 3 blank tasks
    for (let i = 0; i < MIN_TASKS; i++) {
      const id = `default-${Date.now()}-${i}`;
      tasks.push(new Task(id, '', false, i, ''));
    }
    saveTasks();
  };
  
  const saveTasks = () => {
    const dateKey = getDateKey(currentDate);
    
    // Create an object with task IDs as keys
    const tasksObject = {};
    tasks.forEach((task, index) => {
      // Update order based on current position
      task.order = index;
      tasksObject[task.id] = task;
    });
    
    if (currentUser) {
      // Save to Firebase if user is logged in
      const tasksRef = ref(database, `users/${currentUser.uid}/tasks/${dateKey}`);
      set(tasksRef, tasksObject).catch(error => {
        console.error("Error saving tasks to Firebase:", error);
      });
    } else {
      // Save to localStorage if no user is logged in
      saveTasksToLocalStorage(dateKey, tasksObject);
    }
  };
  
  const addNewTask = () => {
    // Enforce MAX_TASKS limit
    if (tasks.length >= MAX_TASKS) {
      alert(`You can only have up to ${MAX_TASKS} tasks per day.`);
      return;
    }
    
    const id = Date.now().toString();
    const order = tasks.length;
    const newTask = new Task(id, '', false, order);
    
    tasks.push(newTask);
    saveTasks();
    renderTasks();
  };
  
  const updateTask = (id, updates) => {
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks[taskIndex] = {...tasks[taskIndex], ...updates};
      saveTasks();
      return true;
    }
    return false;
  };
  
  const deleteTask = (id) => {
    // Can only delete tasks if we have more than MIN_TASKS
    if (tasks.length <= MIN_TASKS) {
      return false;
    }
    
    const taskIndex = tasks.findIndex(t => t.id === id);
    if (taskIndex !== -1) {
      tasks.splice(taskIndex, 1);
      saveTasks();
      renderTasks();
      return true;
    }
    return false;
  };
  
  const updateAddButtonVisibility = () => {
    // Hide add button if we have MAX_TASKS
    addTaskButton.style.display = tasks.length >= MAX_TASKS ? 'none' : 'flex';
  };
  
  // Render Tasks in the DOM
  const renderTasks = () => {
    // Clear previous task elements but keep the empty message
    const taskElements = tasksContainer.querySelectorAll('.task');
    taskElements.forEach(el => el.remove());
    
    // Show/hide empty message
    emptyTasksMessage.style.display = tasks.length > 0 ? 'none' : 'flex';
    
    // Create and append task elements
    tasks.forEach(task => {
      const taskEl = createTaskElement(task);
      tasksContainer.appendChild(taskEl);
    });
    
    // Update add button visibility
    updateAddButtonVisibility();
    
    // Refresh the sortable instance
    setupDragAndDrop();

    // After rendering tasks, update the viewport scale
    setTimeout(updateViewportScale, 0);
  };
  
  const createTaskElement = (task) => {
    const taskEl = document.createElement('div');
    taskEl.className = `task ${task.completed ? 'completed' : ''}`;
    taskEl.dataset.id = task.id;
    
    // Checkbox for completion
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox';
    checkbox.checked = task.completed;
    checkbox.addEventListener('change', () => {
      updateTask(task.id, { completed: checkbox.checked });
      taskEl.classList.toggle('completed', checkbox.checked);
    });
    
    // Editable text
    const textContainer = document.createElement('div');
    textContainer.className = 'task-text';
    
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.value = task.name;
    textInput.placeholder = 'Click to enter task...';
    textInput.readOnly = true;
    textInput.addEventListener('blur', () => {
      if (textInput.value.trim() !== task.name) {
        updateTask(task.id, { name: textInput.value.trim() });
      }
      textInput.readOnly = true;
    });
    textInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        textInput.blur();
      } else if (e.key === 'Escape') {
        textInput.value = task.name;
        textInput.blur();
      }
    });
    
    // Make text clickable for editing
    textInput.addEventListener('click', () => {
      if (textInput.readOnly) {
        textInput.readOnly = false;
        textInput.focus();
        textInput.setSelectionRange(0, textInput.value.length);
      }
    });
    
    // Add better touch support
    textInput.addEventListener('touchend', (e) => {
      if (textInput.readOnly) {
        e.preventDefault();
        textInput.readOnly = false;
        textInput.focus();
        textInput.setSelectionRange(0, textInput.value.length);
      }
    });
    
    textContainer.appendChild(textInput);
    
    // Add delete button only if we have more than MIN_TASKS
    if (tasks.length > MIN_TASKS) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-button';
      deleteBtn.setAttribute('aria-label', 'Delete task');
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteTask(task.id);
      });
      
      // Append delete button
      taskEl.appendChild(checkbox);
      taskEl.appendChild(textContainer);
      taskEl.appendChild(deleteBtn);
    } else {
      // Just append the checkbox and text if we have MIN_TASKS or fewer
      taskEl.appendChild(checkbox);
      taskEl.appendChild(textContainer);
    }
    
    // Setup long press detection for this task element
    setupLongPressDetection(taskEl, task.id);
    
    return taskEl;
  };
  
  // Long press detection for tasks
  const setupLongPressDetection = (taskEl, taskId) => {
    let longPressStarted = false;
    let startX = 0;
    let startY = 0;
    const movementThreshold = 10; // px - movement greater than this will cancel long press
    
    const getClientX = (e) => e.touches ? e.touches[0].clientX : e.clientX;
    const getClientY = (e) => e.touches ? e.touches[0].clientY : e.clientY;
    
    const startLongPress = (e) => {
      // Store the initial position
      startX = getClientX(e);
      startY = getClientY(e);
      
      longPressStarted = true;
      longPressTimer = setTimeout(() => {
        if (longPressStarted) {
          // Visual feedback during long press
          taskEl.classList.add('long-press');
          // Open the task detail modal
          openTaskDetailModal(taskId);
        }
      }, LONG_PRESS_DURATION);
    };
    
    const cancelLongPress = () => {
      longPressStarted = false;
      taskEl.classList.remove('long-press');
      clearTimeout(longPressTimer);
    };
    
    const checkForMovement = (e) => {
      if (!longPressStarted) return;
      
      const currentX = getClientX(e);
      const currentY = getClientY(e);
      
      // Calculate distance moved
      const deltaX = Math.abs(currentX - startX);
      const deltaY = Math.abs(currentY - startY);
      
      // If moved beyond threshold, cancel long press (user is trying to drag)
      if (deltaX > movementThreshold || deltaY > movementThreshold) {
        cancelLongPress();
      }
    };
    
    // Touch events for mobile
    taskEl.addEventListener('touchstart', startLongPress);
    taskEl.addEventListener('touchend', cancelLongPress);
    taskEl.addEventListener('touchcancel', cancelLongPress);
    taskEl.addEventListener('touchmove', checkForMovement);
    
    // Mouse events for desktop
    taskEl.addEventListener('mousedown', startLongPress);
    taskEl.addEventListener('mouseup', cancelLongPress);
    taskEl.addEventListener('mouseleave', cancelLongPress);
    taskEl.addEventListener('mousemove', checkForMovement);
  };
  
  // Drag and drop functionality with better mobile support
  const setupDragAndDrop = () => {
    // Destroy previous instance if it exists
    if (sortableInstance) {
      sortableInstance.destroy();
    }
    
    // Create new sortable instance with optimized mobile settings
    sortableInstance = new Sortable(tasksContainer, {
      animation: 150,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      handle: '.task', // Allow dragging from the task container itself
      filter: '.empty-state, .task-text input', // Don't initiate drag from these elements
      delay: 150, // Small delay for mobile to better distinguish between tap and drag
      delayOnTouchOnly: true, // Only apply delay for touch devices
      touchStartThreshold: 5, // Reduce movement needed to start drag on mobile
      onStart: function(evt) {
        // Prevent drag if we're clicking on text input
        const inputElement = evt.item.querySelector('.task-text input');
        if (document.activeElement === inputElement) {
          evt.cancel = true;
        }
        
        // Ensure any pending long press is canceled when drag starts
        clearTimeout(longPressTimer);
        evt.item.classList.remove('long-press');
      },
      onSort: () => {
        // Re-order tasks array based on DOM order
        const taskElements = tasksContainer.querySelectorAll('.task');
        const newTasksOrder = [];
        
        taskElements.forEach((el, index) => {
          const taskId = el.dataset.id;
          const task = tasks.find(t => t.id === taskId);
          if (task) {
            task.order = index;
            newTasksOrder.push(task);
          }
        });
        
        // Update tasks array with new order
        tasks = newTasksOrder;
        saveTasks();
      }
    });
  };
  
  // Open task detail modal
  const openTaskDetailModal = (taskId) => {
    currentTaskId = taskId;
    const task = tasks.find(t => t.id === taskId);
    
    if (task) {
      detailTaskName.value = task.name;
      taskAdditionalInfo.value = task.additionalInfo || '';
      taskDetailModal.style.display = 'block';
      
      // Focus the task name field with a slight delay to ensure modal is visible
      setTimeout(() => detailTaskName.focus(), 100);
    }
  };
  
  // Close task detail modal
  const closeTaskDetailModal = () => {
    taskDetailModal.style.display = 'none';
    currentTaskId = null;
  };
  
  // Save task details from modal
  const saveTaskDetails = () => {
    if (currentTaskId) {
      const taskName = detailTaskName.value.trim();
      const additionalInfo = taskAdditionalInfo.value.trim();
      
      updateTask(currentTaskId, { 
        name: taskName,
        additionalInfo: additionalInfo
      });
      
      // Update the task in the DOM
      const taskEl = document.querySelector(`.task[data-id="${currentTaskId}"]`);
      if (taskEl) {
        const input = taskEl.querySelector('.task-text input');
        if (input) {
          input.value = taskName;
        }
      }
      
      closeTaskDetailModal();
      renderTasks(); // Re-render to ensure UI is updated
    }
  };
  
  // Public methods
  return {
    init
  };
})();

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', App.init);