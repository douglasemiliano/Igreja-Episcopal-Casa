import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();
  private pendentes = 0;

  show() {
    this.pendentes++;
    this.loadingSubject.next(true);
  }

  hide() {
    this.pendentes = Math.max(0, this.pendentes - 1);
    if (this.pendentes === 0) {
      this.loadingSubject.next(false);
    }
  }
}